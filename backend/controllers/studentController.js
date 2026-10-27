// Request handlers for student profile CRUD. Role-based visibility scoping
// happens inside studentModel (every query is passed req.user); this file
// only handles input validation, error shaping, and who may write.
const studentModel = require('../models/studentModel');
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const passwordReset = require('../services/passwordReset');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const riskAssessmentModel = require('../models/riskAssessmentModel');
const classOfferingModel = require('../models/classOfferingModel');
const {
  stripLearnerStatus,
  stripLearnerStatusFromList,
  allowedFilterKeys,
  stripUnwritableLearnerStatusFields,
} = require('../utils/learnerStatusVisibility');
const { LEARNER_STATUS_FIELDS, fieldsVisibleTo } = require('../config/learnerStatus');

// Column -> the query-string param the roster filters with, and a compact
// label for a checkbox in a crowded toolbar.
const FILTER_PARAM_BY_KEY = { is_pwd: 'isPwd', is_4ps: 'is4ps', is_als_graduate: 'isAlsGraduate' };
const SHORT_LABELS = { is_pwd: 'PWD only', is_4ps: '4Ps only', is_als_graduate: 'ALS only' };
const { buildAcademicProgress } = require('../services/academicProgressCalculator');
// Shared with services/bulkImportValidator.js so a single-student edit and a
// bulk-imported row can never silently disagree about what's valid.
const { validateStudentInput } = require('../utils/studentValidation');

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

// Learner-status filters the CALLER is actually allowed to use. Gated
// against the same map that strips the fields from responses: filtering a
// roster down to "only 4Ps learners" reveals exactly what the hidden column
// would have, so a role that can't read the field can't filter by it
// either. A disallowed param is ignored rather than erroring — it's not a
// client mistake worth failing the whole request over.
function parseLearnerStatusFilters(req) {
  const allowed = allowedFilterKeys(req.user);
  const requested = { isPwd: 'is_pwd', is4ps: 'is_4ps', isAlsGraduate: 'is_als_graduate' };
  const filters = {};
  for (const [param, column] of Object.entries(requested)) {
    if (req.query[param] === 'true' && allowed.has(column)) filters[param] = true;
  }
  return filters;
}

async function listStudents(req, res) {
  const { search, gradeLevel, sectionId, status, includeInactive, hasAccount, sortBy, sortDir, page, pageSize } = req.query;

  const result = await studentModel.listStudents(req.user, {
    learnerStatus: parseLearnerStatusFilters(req),
    search,
    gradeLevel: gradeLevel ? Number(gradeLevel) : undefined,
    sectionId: sectionId ? Number(sectionId) : undefined,
    status,
    includeInactive: includeInactive === 'true',
    hasAccount: hasAccount === 'true' ? true : hasAccount === 'false' ? false : undefined,
    sortBy: VALID_SORT_BY.includes(sortBy) ? sortBy : undefined,
    sortDir: sortDir === 'desc' ? 'desc' : 'asc',
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });

  // The roster never displays these as badges (see the Students list), but
  // strip them anyway — the list endpoint is reachable directly, and a
  // field nobody renders is still a field that was sent.
  res.json({ ...result, students: stripLearnerStatusFromList(req.user, result.students) });
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
  // Server-side enforcement, not a UI concern: a role that may not see a
  // learner's PWD or 4Ps status never receives the field at all. This also
  // covers the student's own My Profile view, since 'student' appears in no
  // field's visibleToRoles list (see config/learnerStatus.js).
  res.json({ student: stripLearnerStatus(req.user, student) });
}

// The subjects this student is currently taking, i.e. their section's
// active class offerings for the current school year. Scoped by the exact
// same findById() call getStudent uses, so a student asking for anyone
// else's id gets the same 404 they'd get from the profile itself — this
// route can't become a way to enumerate other sections' timetables.
async function getStudentSubjects(req, res) {
  const student = await studentModel.findById(req.user, Number(req.params.id));
  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }
  // Not an error — a student between section assignments simply has none yet.
  if (!student.current_section_id) {
    return res.json({ subjects: [] });
  }
  const subjects = await classOfferingModel.listBySection(student.current_section_id);
  res.json({ subjects });
}

// A writer can only set learner-status fields they're allowed to SEE. In
// practice both roles that can write students (admin, registrar) can see
// all three, so this changes nothing today — it's here so that adding a
// write-capable role later can't silently hand it a field the visibility
// map says it shouldn't have.
function stripUnwritableLearnerStatus(req) {
  return stripUnwritableLearnerStatusFields(req.user, req.body);
}

// Which learner-status fields THIS caller may see — and therefore filter
// by. The roster UI asks rather than hardcoding the role list a second
// time, so config/learnerStatus.js stays the only place the rule lives.
async function getLearnerStatusFields(req, res) {
  const allowed = fieldsVisibleTo(req.user?.role);
  res.json({
    fields: LEARNER_STATUS_FIELDS.filter((f) => allowed.includes(f.key)).map((f) => ({
      key: f.key,
      param: FILTER_PARAM_BY_KEY[f.key],
      label: f.label,
      shortLabel: SHORT_LABELS[f.key],
    })),
  });
}

async function createStudent(req, res) {
  const errors = validateStudentInput(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  try {
    const id = await studentModel.createStudent(stripUnwritableLearnerStatus(req));
    const student = await studentModel.findByIdUnscoped(id);
    res.status(201).json({ student: stripLearnerStatus(req.user, student) });
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
    const updated = await studentModel.updateStudent(Number(req.params.id), stripUnwritableLearnerStatus(req));
    if (!updated) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    const student = await studentModel.findByIdUnscoped(updated.id);
    res.json({ student: stripLearnerStatus(req.user, student) });
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

// The Student Detail page's Academic Progress Tracking badge (formerly
// "risk badge") — current period's assessment (if any), its band (At Risk /
// Average-Steady / Performing Well), triggered factors, and advisory/
// encouragement/recognition text, via the exact same
// academicProgressCalculator.buildAcademicProgress call the Academic
// Progress Tracking dashboard uses, so the two can never disagree.
// route-gated to admin/adviser/guidance_counselor, the same audience as
// that dashboard and Interventions — narrower than the general
// student-profile visibility rule, since this is more sensitive than a
// roster entry.
async function getAcademicProgress(req, res) {
  const student = await studentModel.findById(req.user, Number(req.params.id));
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const currentPeriod = await gradingPeriodModel.findByDate(todayInSchoolTimezone());
  if (!currentPeriod) return res.json({ academicProgress: null });

  const assessment = await riskAssessmentModel.getForStudentAndPeriod(student.id, currentPeriod.id);
  if (!assessment) return res.json({ academicProgress: null });

  const progress = buildAcademicProgress({
    riskScore: assessment.risk_score,
    averageGrade: assessment.average_grade != null ? Number(assessment.average_grade) : null,
    gradeTrend: assessment.grade_trend != null ? Number(assessment.grade_trend) : null,
    attendanceRate: assessment.attendance_rate != null ? Number(assessment.attendance_rate) : null,
    attendanceTrend: assessment.attendance_trend != null ? Number(assessment.attendance_trend) : null,
  });

  res.json({
    academicProgress: {
      riskLevel: assessment.risk_level,
      riskScore: assessment.risk_score,
      calculatedAt: assessment.calculated_at,
      band: progress.band,
      bandLabel: progress.bandLabel,
      factors: progress.factors,
      advisories: progress.advisories,
      topConcern: progress.topConcern,
      note: progress.note,
    },
  });
}

module.exports = {
  listStudents,
  getStats,
  getStudent,
  getStudentSubjects,
  getLearnerStatusFields,
  getAcademicProgress,
  createStudent,
  updateStudent,
  deactivateStudent,
  reactivateStudent,
  resetPassword,
};
