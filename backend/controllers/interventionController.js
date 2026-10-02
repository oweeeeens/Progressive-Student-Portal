// Handlers for logging and tracking interventions (CLAUDE.md Part B).
// Visibility is narrower than general Student Records: only admin,
// guidance_counselor (unrestricted), and the student's own adviser — not
// subject_teacher, registrar, or the student themselves. Counseling/
// intervention notes are sensitive in the same way enrollment documents are,
// so this reuses studentModel.findById purely for its scoping rule (adviser
// -> own section only, admin/guidance_counselor -> unrestricted), gated by
// route-level requireRole so subject_teacher/student never reach it even
// though that function would also allow them through for other purposes.
const interventionModel = require('../models/interventionModel');
const riskAssessmentModel = require('../models/riskAssessmentModel');
const studentModel = require('../models/studentModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');

async function resolveAuthorizedStudent(req, res, studentId) {
  const student = await studentModel.findById(req.user, studentId);
  if (!student) res.status(404).json({ error: 'Student not found.' });
  return student;
}

async function createIntervention(req, res) {
  const studentId = Number(req.params.studentId);
  const { interventionType, notes, dateLogged } = req.body;

  if (!interventionModel.VALID_TYPES.includes(interventionType)) {
    return res.status(400).json({ error: `interventionType must be one of: ${interventionModel.VALID_TYPES.join(', ')}` });
  }

  const student = await resolveAuthorizedStudent(req, res, studentId);
  if (!student) return;

  const currentPeriod = await gradingPeriodModel.findByDate(new Date().toISOString().slice(0, 10));
  if (!currentPeriod) {
    return res.status(400).json({ error: 'No grading period is configured for today.' });
  }

  // "When a student is flagged as at-risk" means a risk_assessment must
  // already exist for the current period — an intervention is a response to
  // a known flag, not a prediction, and it needs that assessment's id to
  // capture "the risk level at time of intervention" per CLAUDE.md.
  const assessment = await riskAssessmentModel.getForStudentAndPeriod(studentId, currentPeriod.id);
  if (!assessment) {
    return res.status(400).json({
      error: 'No risk assessment exists yet for this student in the current grading period — risk must be calculated first.',
    });
  }

  const intervention = await interventionModel.create({
    studentId,
    riskAssessmentId: assessment.id,
    loggedBy: req.user.id,
    interventionType,
    notes,
    dateLogged,
  });
  res.status(201).json({ intervention });
}

async function listForStudent(req, res) {
  const studentId = Number(req.params.studentId);
  const student = await resolveAuthorizedStudent(req, res, studentId);
  if (!student) return;

  const interventions = await interventionModel.listForStudent(studentId);
  res.json({ interventions });
}

// Cross-student list backing the standalone Interventions page. Visibility
// is already handled inside interventionModel.listAll (same appendScopeClause
// rule as everywhere else), not here — this handler just validates filters.
async function listAll(req, res) {
  const { search, status, interventionType, page, pageSize } = req.query;

  if (status && !interventionModel.VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${interventionModel.VALID_STATUSES.join(', ')}` });
  }
  if (interventionType && !interventionModel.VALID_TYPES.includes(interventionType)) {
    return res.status(400).json({ error: `interventionType must be one of: ${interventionModel.VALID_TYPES.join(', ')}` });
  }

  const result = await interventionModel.listAll(req.user, { search, status, interventionType, page, pageSize });
  res.json(result);
}

async function getStats(req, res) {
  const counts = await interventionModel.countsByStatus(req.user);
  res.json({ counts });
}

async function updateStatus(req, res) {
  const { status } = req.body;
  if (!interventionModel.VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${interventionModel.VALID_STATUSES.join(', ')}` });
  }

  const existing = await interventionModel.getById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Intervention not found.' });

  const student = await resolveAuthorizedStudent(req, res, existing.student_id);
  if (!student) return;

  const intervention = await interventionModel.updateStatus(existing.id, status);
  res.json({ intervention });
}

module.exports = { createIntervention, listForStudent, listAll, getStats, updateStatus };
