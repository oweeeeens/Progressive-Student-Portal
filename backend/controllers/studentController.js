// Request handlers for student profile CRUD. Role-based visibility scoping
// happens inside studentModel (every query is passed req.user); this file
// only handles input validation, error shaping, and who may write.
const studentModel = require('../models/studentModel');
const { provisionStudentAccountIfReady } = require('../services/accountProvisioning');
const passwordReset = require('../services/passwordReset');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const riskAssessmentModel = require('../models/riskAssessmentModel');
const riskCalculator = require('../services/riskCalculator');

const LRN_PATTERN = /^\d{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SEX = ['M', 'F'];
const VALID_ENROLLMENT_STATUS = ['pending', 'enrolled', 'dropped', 'transferred', 'graduated'];

// Validates the fields present in `data`. When `partial` is true (PATCH),
// fields that are simply absent are skipped rather than treated as missing.
function validateStudentInput(data, { partial = false } = {}) {
  const errors = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(data, key);

  if (!partial || has('lrn')) {
    if (!data.lrn || !LRN_PATTERN.test(data.lrn)) {
      errors.push('lrn must be exactly 12 digits (DepEd Learner Reference Number).');
    }
  }
  if (!partial || has('firstName')) {
    if (!data.firstName || !data.firstName.trim()) errors.push('firstName is required.');
  }
  if (!partial || has('lastName')) {
    if (!data.lastName || !data.lastName.trim()) errors.push('lastName is required.');
  }
  if (!partial || has('dateOfBirth')) {
    const date = new Date(data.dateOfBirth);
    if (!data.dateOfBirth || Number.isNaN(date.getTime()) || date > new Date()) {
      errors.push('dateOfBirth must be a valid past date (YYYY-MM-DD).');
    }
  }
  if (has('sex') && data.sex && !VALID_SEX.includes(data.sex)) {
    errors.push(`sex must be one of: ${VALID_SEX.join(', ')}`);
  }
  if (has('enrollmentStatus') && data.enrollmentStatus && !VALID_ENROLLMENT_STATUS.includes(data.enrollmentStatus)) {
    errors.push(`enrollmentStatus must be one of: ${VALID_ENROLLMENT_STATUS.join(', ')}`);
  }
  if (has('currentSectionId') && data.currentSectionId !== null && !Number.isInteger(data.currentSectionId)) {
    errors.push('currentSectionId must be an integer or null.');
  }
  if (has('email') && data.email && !EMAIL_PATTERN.test(data.email)) {
    errors.push('email does not look like a valid email address.');
  }

  return errors;
}

// Postgres error codes for constraints we want to turn into friendly 400s
// instead of a raw 500. error.constraint tells us which UNIQUE constraint
// fired, since students has more than one (lrn, email).
function handleWriteError(error, res) {
  if (error.code === '23505') {
    if (error.constraint === 'students_email_key') {
      return res.status(409).json({ error: 'A student with that email already exists.' });
    }
    return res.status(409).json({ error: 'A student with that LRN already exists.' });
  }
  if (error.code === '23503') {
    return res.status(400).json({ error: 'currentSectionId does not refer to an existing section.' });
  }
  throw error;
}

const VALID_SORT_BY = ['name', 'status'];

async function listStudents(req, res) {
  const { search, gradeLevel, sectionId, status, includeInactive, sortBy, sortDir, page, pageSize } = req.query;

  const result = await studentModel.listStudents(req.user, {
    search,
    gradeLevel: gradeLevel ? Number(gradeLevel) : undefined,
    sectionId: sectionId ? Number(sectionId) : undefined,
    status,
    includeInactive: includeInactive === 'true',
    sortBy: VALID_SORT_BY.includes(sortBy) ? sortBy : undefined,
    sortDir: sortDir === 'desc' ? 'desc' : 'asc',
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });

  res.json(result);
}

// Summary counts for the list page's stat cards — scoped the same way the
// list itself is, so the totals always match what the user can actually browse.
async function getStats(req, res) {
  const counts = await studentModel.countsByEnrollmentStatus(req.user);
  res.json({ counts });
}

async function getStudent(req, res) {
  const student = await studentModel.findById(req.user, Number(req.params.id));
  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }
  res.json({ student });
}

async function createStudent(req, res) {
  const errors = validateStudentInput(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  try {
    const id = await studentModel.createStudent(req.body);
    const student = await studentModel.findByIdUnscoped(id);
    // Self-checking no-op unless this student was created already-enrolled
    // with an email — see services/accountProvisioning.js.
    const provisioned = await provisionStudentAccountIfReady(id);
    res.status(201).json({ student, accountProvisioned: provisioned });
  } catch (error) {
    handleWriteError(error, res);
  }
}

async function updateStudent(req, res) {
  const errors = validateStudentInput(req.body, { partial: true });
  if (errors.length) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  try {
    const updated = await studentModel.updateStudent(Number(req.params.id), req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    const student = await studentModel.findByIdUnscoped(updated.id);
    // Covers both paths that can reach 'enrolled': this direct edit, and the
    // auto-advance from enrollment document verification (see
    // enrollmentDocumentController.js) — self-checking no-op otherwise.
    const provisioned = await provisionStudentAccountIfReady(updated.id);
    res.json({ student, accountProvisioned: provisioned });
  } catch (error) {
    handleWriteError(error, res);
  }
}

// Soft-delete only — students keep their academic history (is_active=false),
// never a hard DELETE. See schema notes on ON DELETE RESTRICT.
async function deactivateStudent(req, res) {
  const updated = await studentModel.setActive(Number(req.params.id), false);
  if (!updated) {
    return res.status(404).json({ error: 'Student not found.' });
  }
  res.status(204).end();
}

async function reactivateStudent(req, res) {
  const updated = await studentModel.setActive(Number(req.params.id), true);
  if (!updated) {
    return res.status(404).json({ error: 'Student not found.' });
  }
  res.status(204).end();
}

// The admin/registrar manual-reset fallback, keyed off the student (not a
// raw user id — consistent with every other student-nested route in this
// app). 400s if the student has no portal account yet rather than
// crashing on a null user_id.
async function resetPassword(req, res) {
  const info = await studentModel.getAccountProvisioningInfo(Number(req.params.id));
  if (!info) return res.status(404).json({ error: 'Student not found.' });
  if (!info.user_id) {
    return res.status(400).json({ error: 'This student does not have a portal account yet.' });
  }

  const tempPassword = await passwordReset.resetUserPasswordToTemp(info.user_id);
  res.json({ tempPassword });
}

// The Student Detail page's risk badge — current period's assessment (if
// any) plus its triggered factors, via the exact same evaluateFactors call
// the Risk Dashboard uses, so the two can never disagree. route-gated to
// admin/adviser/guidance_counselor, the same audience as the Risk
// Dashboard and Interventions — narrower than the general student-profile
// visibility rule, since risk standing is more sensitive than a roster entry.
async function getRisk(req, res) {
  const student = await studentModel.findById(req.user, Number(req.params.id));
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const currentPeriod = await gradingPeriodModel.findByDate(new Date().toISOString().slice(0, 10));
  if (!currentPeriod) return res.json({ risk: null });

  const assessment = await riskAssessmentModel.getForStudentAndPeriod(student.id, currentPeriod.id);
  if (!assessment) return res.json({ risk: null });

  const factors = riskCalculator.evaluateFactors({
    currentGrade: assessment.average_grade != null ? Number(assessment.average_grade) : null,
    gradeTrend: assessment.grade_trend != null ? Number(assessment.grade_trend) : null,
    currentAttendanceRate: assessment.attendance_rate != null ? Number(assessment.attendance_rate) : null,
    attendanceTrend: assessment.attendance_trend != null ? Number(assessment.attendance_trend) : null,
  });

  res.json({
    risk: {
      riskLevel: assessment.risk_level,
      riskScore: assessment.risk_score,
      calculatedAt: assessment.calculated_at,
      factors,
    },
  });
}

module.exports = {
  listStudents,
  getStats,
  getStudent,
  getRisk,
  createStudent,
  updateStudent,
  deactivateStudent,
  reactivateStudent,
  resetPassword,
};
