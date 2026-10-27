// Handlers for the full grade approval chain: subject teacher submits ->
// principal verifies or rejects -> adviser finalizes. Finalizing is the
// trigger point for risk recalculation — see riskEngine.js and CLAUDE.md's
// "recalculated whenever new grades/attendance are entered."
const gradeModel = require('../models/gradeModel');
const studentModel = require('../models/studentModel');
const classOfferingModel = require('../models/classOfferingModel');
const sectionModel = require('../models/sectionModel');
const riskEngine = require('../services/riskEngine');

async function recordGrades(req, res) {
  const { classOfferingId, gradingPeriodId, entries } = req.body;

  if (!classOfferingId || !gradingPeriodId || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'classOfferingId, gradingPeriodId, and a non-empty entries array are required.' });
  }
  const invalidValue = entries.find((e) => typeof e.gradeValue !== 'number' || e.gradeValue < 60 || e.gradeValue > 100);
  if (invalidValue) {
    return res.status(400).json({ error: 'Each gradeValue must be a number between 60 and 100.' });
  }

  const offering = await classOfferingModel.getById(classOfferingId);
  if (!offering) {
    return res.status(400).json({ error: 'classOfferingId does not refer to an existing class.' });
  }
  // Ownership by assignment (teacher_id), not by role label — see
  // classOfferingController.getRoster's matching comment.
  if (req.user.role !== 'admin' && offering.teacher_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only record grades for classes you teach.' });
  }

  const roster = await gradeModel.getActiveStudentsInOffering(classOfferingId);
  const rosterIds = new Set(roster.map((s) => s.id));
  const unknownStudent = entries.find((e) => !rosterIds.has(e.studentId));
  if (unknownStudent) {
    return res.status(400).json({ error: `Student ${unknownStudent.studentId} is not currently in this class.` });
  }

  const saved = await gradeModel.upsertSubmittedGrades({
    classOfferingId,
    gradingPeriodId,
    recordedBy: req.user.id,
    entries,
  });

  // Entries the upsert refused because that grade is already finalized —
  // the adviser has put it into the official record, so it is no longer the
  // subject teacher's to change. Reported rather than dropped silently: a
  // teacher who thinks they just corrected a mark needs to know they did not.
  const savedStudentIds = new Set(saved.map((row) => row.student_id));
  const skipped = entries
    .filter((entry) => !savedStudentIds.has(entry.studentId))
    .map((entry) => entry.studentId);

  res.status(201).json({
    grades: saved,
    skippedFinalizedStudentIds: skipped,
    ...(skipped.length > 0 && {
      message:
        `${skipped.length} grade${skipped.length === 1 ? ' was' : 's were'} already finalized by the adviser ` +
        'and left unchanged. Ask them to reopen it if it needs correcting.',
    }),
  });
}

// Lets the entry page reopen a class+period it already submitted: prefill
// existing values and surface the current status (and rejection note, if
// any) per student, instead of always starting from a blank sheet.
async function getSubmissionsForOffering(req, res) {
  const { classOfferingId, gradingPeriodId } = req.query;
  if (!classOfferingId || !gradingPeriodId) {
    return res.status(400).json({ error: 'classOfferingId and gradingPeriodId query params are required.' });
  }

  const offering = await classOfferingModel.getById(Number(classOfferingId));
  if (!offering) return res.status(404).json({ error: 'Class not found.' });
  if (req.user.role !== 'admin' && offering.teacher_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only view grades for classes you teach.' });
  }

  const submissions = await gradeModel.getSubmissionsForOffering(Number(classOfferingId), Number(gradingPeriodId));
  res.json({ submissions });
}

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
  res.json({ verified });
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
  const grades = await gradeModel.getHistoryForStudent(req.scopedStudent.id);
  // The per-period average series already existed for the risk engine's own
  // trend calc (see gradeModel.getFinalizedAveragesByPeriod) — reused as-is
  // for the detail page's sparkline rather than re-deriving it from `grades`.
  const schoolYearId = await studentModel.resolveSchoolYearId(req.scopedStudent.id);
  const periodAverages = await gradeModel.getFinalizedAveragesByPeriod(req.scopedStudent.id, schoolYearId);
  res.json({ grades, periodAverages });
}

module.exports = {
  recordGrades,
  getSubmissionsForOffering,
  listSubmittedGrades,
  verifyGrades,
  rejectGrades,
  listPrincipalVerifiedForSection,
  finalizeGrades,
  getHistoryForStudent,
};
