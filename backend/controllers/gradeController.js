// Handlers for the full grade approval chain: subject teacher submits ->
// principal verifies or rejects -> adviser finalizes. Finalizing is the
// trigger point for risk recalculation — see riskEngine.js and CLAUDE.md's
// "recalculated whenever new grades/attendance are entered."
const gradeModel = require('../models/gradeModel');
const studentModel = require('../models/studentModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const sectionModel = require('../models/sectionModel');
const riskEngine = require('../services/riskEngine');
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const { GRADE_AT_RISK_THRESHOLD } = require('../config/riskConfig');

// The principal's review queue — school-wide, not scoped to one section,
// since there is only one principal for the whole school.
async function listSubmittedGrades(req, res) {
  const { gradingPeriodId, sectionId, page, pageSize } = req.query;
  if (!gradingPeriodId) {
    return res.status(400).json({ error: 'gradingPeriodId query param is required.' });
  }
  const result = await gradeModel.listSubmittedGrades({
    gradingPeriodId: Number(gradingPeriodId),
    sectionId: sectionId ? Number(sectionId) : null,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 20,
  });
  res.json(result);
}

// The ids in a bulk verify/reject body go straight into `ANY($1::int[])`, so
// anything that is not an integer reaches Postgres as a cast error and
// surfaces as an unhandled 500 rather than a message anyone can act on.
// Returns null when the body is unusable, having already answered.
function readGradeIds(req, res) {
  const { gradeIds } = req.body;
  if (!Array.isArray(gradeIds) || gradeIds.length === 0) {
    res.status(400).json({ error: 'gradeIds must be a non-empty array.' });
    return null;
  }
  const ids = gradeIds.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    res.status(400).json({ error: 'gradeIds must all be positive integers.' });
    return null;
  }
  // The period the principal's queue was filtered to. Required, so a bulk
  // action can only ever touch the batch in front of them.
  const gradingPeriodId = Number(req.body.gradingPeriodId);
  if (!Number.isInteger(gradingPeriodId) || gradingPeriodId <= 0) {
    res.status(400).json({ error: 'gradingPeriodId is required.' });
    return null;
  }
  return { ids, gradingPeriodId };
}

async function verifyGrades(req, res) {
  const parsed = readGradeIds(req, res);
  if (!parsed) return;

  const verifiedIds = await gradeModel.verifyGrades(parsed.ids, req.user.id, parsed.gradingPeriodId);
  res.json({ verifiedCount: verifiedIds.length, gradeIds: verifiedIds });
}

async function rejectGrades(req, res) {
  const { note } = req.body;
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'A rejection note is required so the subject teacher knows what to fix.' });
  }
  const parsed = readGradeIds(req, res);
  if (!parsed) return;

  const rejectedIds = await gradeModel.rejectGrades(parsed.ids, req.user.id, note.trim(), parsed.gradingPeriodId);
  res.json({ rejectedCount: rejectedIds.length, gradeIds: rejectedIds });
}

async function listPrincipalVerifiedForSection(req, res) {
  const { sectionId, gradingPeriodId } = req.query;
  if (!sectionId || !gradingPeriodId) {
    return res.status(400).json({ error: 'sectionId and gradingPeriodId query params are required.' });
  }

  const section = await sectionModel.getSectionById(Number(sectionId));
  if (!section) return res.status(404).json({ error: 'Section not found.' });
  // Ownership by assignment (adviser_id), not by role label — an adviser
  // can also be assigned to teach a class, and someone whose role isn't
  // literally 'adviser' can still be set as a section's adviser_id.
  if (req.user.role !== 'admin' && section.adviser_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only review grades for your own advisory section.' });
  }

  const verified = await gradeModel.listPrincipalVerifiedForSection(Number(sectionId), Number(gradingPeriodId));
  // Where the rest of this section's grades are in the chain, so an empty
  // list can say WHY it is empty (see countStatusesForSectionPeriod).
  const pipeline = await gradeModel.countStatusesForSectionPeriod(Number(sectionId), Number(gradingPeriodId));
  res.json({ verified, pipeline });
}

async function finalizeGrades(req, res) {
  const { sectionId, gradingPeriodId } = req.body;
  if (!sectionId || !gradingPeriodId) {
    return res.status(400).json({ error: 'sectionId and gradingPeriodId are required.' });
  }

  const section = await sectionModel.getSectionById(sectionId);
  if (!section) return res.status(400).json({ error: 'sectionId does not refer to an existing section.' });
  if (req.user.role !== 'admin' && section.adviser_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only finalize grades for your own advisory section.' });
  }

  const affectedStudentIds = await gradeModel.finalizeSectionGrades(sectionId, gradingPeriodId, req.user.id);

  // The whole point of finalizing is that these grades now count toward
  // risk — recalculate immediately for exactly the students whose grades
  // just changed, not the whole section/school (per CLAUDE.md: triggered by
  // the data change, not on a schedule).
  await riskEngine.recalculateRiskForStudents(affectedStudentIds, gradingPeriodId);

  res.json({ finalizedCount: affectedStudentIds.length, studentIds: affectedStudentIds });
}

async function getHistoryForStudent(req, res) {
  // Resolved first, because BOTH queries below need it. The grade history
  // used to be fetched without it while the averages beside it were scoped —
  // so a learner in their second year had two sets of terms in one table
  // and one set in the chart under it.
  const schoolYearId = await studentModel.resolveSchoolYearId(req.scopedStudent.id);

  const grades = await gradeModel.getHistoryForStudent(req.scopedStudent.id, schoolYearId);
  // The per-period average series already existed for the risk engine's own
  // trend calc (see gradeModel.getFinalizedAveragesByPeriod) — reused as-is
  // for the detail page's sparkline rather than re-deriving it from `grades`.
  const periodAverages = await gradeModel.getFinalizedAveragesByPeriod(req.scopedStudent.id, schoolYearId);

  // The terms this year actually has, so the reader can group by them
  // without inferring the list from whichever grades happen to exist — a
  // term with no marks yet is information, and inferring the list hides it.
  // Carries `sequence_number`, which is what decides which subjects run in
  // it (config/academicTerms.js).
  const gradingPeriods = await gradingPeriodModel.listBySchoolYear(schoolYearId);

  // Which of those terms the school is in today, so the page can mark it.
  // The school's own date, not the server's UTC one (utils/schoolDate.js).
  // Null between terms — "the current term" then has no answer, and the page
  // marks nothing rather than guessing.
  const today = todayInSchoolTimezone();
  const currentPeriod = gradingPeriods.find(
    (p) => String(p.start_date).slice(0, 10) <= today && today <= String(p.end_date).slice(0, 10)
  );

  // The passing grade travels with the grades so every grade view colours
  // the same marks red. It is the risk formula's own threshold (config/
  // riskConfig.js), the same figure the student's My Grades page uses.
  res.json({
    grades,
    periodAverages,
    gradingPeriods,
    schoolYearId,
    currentPeriodId: currentPeriod ? currentPeriod.id : null,
    passingGrade: GRADE_AT_RISK_THRESHOLD,
  });
}

module.exports = {
  listSubmittedGrades,
  verifyGrades,
  rejectGrades,
  listPrincipalVerifiedForSection,
  finalizeGrades,
  getHistoryForStudent,
};
