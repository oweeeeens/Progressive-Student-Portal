// Handlers for grade entry (subject teacher) and finalization (adviser).
// Finalizing is the trigger point for risk recalculation — see riskEngine.js
// and CLAUDE.md's "recalculated whenever new grades/attendance are entered."
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
  if (req.user.role === 'subject_teacher' && offering.teacher_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only record grades for classes you teach.' });
  }

  const roster = await gradeModel.getActiveStudentsInOffering(classOfferingId);
  const rosterIds = new Set(roster.map((s) => s.id));
  const unknownStudent = entries.find((e) => !rosterIds.has(e.studentId));
  if (unknownStudent) {
    return res.status(400).json({ error: `Student ${unknownStudent.studentId} is not currently in this class.` });
  }

  const saved = await gradeModel.upsertDraftGrades({
    classOfferingId,
    gradingPeriodId,
    recordedBy: req.user.id,
    entries,
  });
  res.status(201).json({ grades: saved });
}

async function listDraftsForSection(req, res) {
  const { sectionId, gradingPeriodId } = req.query;
  if (!sectionId || !gradingPeriodId) {
    return res.status(400).json({ error: 'sectionId and gradingPeriodId query params are required.' });
  }

  const section = await sectionModel.getSectionById(Number(sectionId));
  if (!section) return res.status(404).json({ error: 'Section not found.' });
  if (req.user.role === 'adviser' && section.adviser_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only review grades for your own advisory section.' });
  }

  const drafts = await gradeModel.listDraftsForSection(Number(sectionId), Number(gradingPeriodId));
  res.json({ drafts });
}

async function finalizeGrades(req, res) {
  const { sectionId, gradingPeriodId } = req.body;
  if (!sectionId || !gradingPeriodId) {
    return res.status(400).json({ error: 'sectionId and gradingPeriodId are required.' });
  }

  const section = await sectionModel.getSectionById(sectionId);
  if (!section) return res.status(400).json({ error: 'sectionId does not refer to an existing section.' });
  if (req.user.role === 'adviser' && section.adviser_id !== req.user.id) {
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

module.exports = { recordGrades, listDraftsForSection, finalizeGrades, getHistoryForStudent };
