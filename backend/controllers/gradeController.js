// Handlers for the full grade approval chain: subject teacher submits ->
// principal verifies or rejects -> adviser finalizes. Finalizing is the
// trigger point for risk recalculation — see riskEngine.js and CLAUDE.md's
// "recalculated whenever new grades/attendance are entered."
const gradeModel = require('../models/gradeModel');
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
  res.status(201).json({ grades: saved });
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

async function verifyGrades(req, res) {
  const { gradeIds } = req.body;
  if (!Array.isArray(gradeIds) || gradeIds.length === 0) {
    return res.status(400).json({ error: 'gradeIds must be a non-empty array.' });
  }
  const verifiedIds = await gradeModel.verifyGrades(gradeIds, req.user.id);
  res.json({ verifiedCount: verifiedIds.length, gradeIds: verifiedIds });
}

async function rejectGrades(req, res) {
  const { gradeIds, note } = req.body;
  if (!Array.isArray(gradeIds) || gradeIds.length === 0) {
    return res.status(400).json({ error: 'gradeIds must be a non-empty array.' });
  }
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'A rejection note is required so the subject teacher knows what to fix.' });
  }
  const rejectedIds = await gradeModel.rejectGrades(gradeIds, req.user.id, note.trim());
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
  const periodAverages = await gradeModel.getFinalizedAveragesByPeriod(req.scopedStudent.id);
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
