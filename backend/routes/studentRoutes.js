// Student profile CRUD, mounted at /api/students.
// Reads are open to every authenticated role — studentModel scopes what each
// role actually sees (adviser: own section, subject teacher: own classes,
// student: self, admin/registrar/guidance_counselor: everyone). Writes are
// restricted to admin/registrar, who CLAUDE.md names as the roles that
// manage student records/enrollment.
const express = require('express');
const {
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
} = require('../controllers/studentController');
const { generateReportCard } = require('../controllers/reportCardController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
const canWrite = requireRole('admin', 'registrar');

router.use(requireAuth);

router.get('/', listStudents);
// Must stay above '/:id' — otherwise Express matches "stats" as an id.
router.get('/stats', getStats);
// Must stay above '/:id' too — same reason as /stats.
router.get('/learner-status-fields', getLearnerStatusFields);
router.get('/:id', getStudent);
// No role gate: visibility is scoped per-student inside the controller, the
// same way GET /:id is — a student sees their own subjects, nobody else's.
router.get('/:id/subjects', getStudentSubjects);
// Principal included: they already see the school-wide rollup of exactly
// this data on the Analytics dashboard, so withholding the per-student
// version only broke the drill-down, it didn't protect anything.
// Deliberately NOT extended to interventions below — logging and
// managing follow-up stays admin/adviser/guidance_counselor.
router.get(
  '/:id/academic-progress',
  requireRole('admin', 'principal', 'adviser', 'guidance_counselor'),
  getAcademicProgress
);
// No role gate — admin/registrar/actual-adviser-of-the-section is checked
// by assignment inside the controller itself (see reportCardController.js).
router.get('/:id/report-card', generateReportCard);
router.post('/', canWrite, createStudent);
router.patch('/:id', canWrite, updateStudent);
router.delete('/:id', canWrite, deactivateStudent);
router.post('/:id/reactivate', canWrite, reactivateStudent);
router.post('/:id/reset-password', canWrite, resetPassword);

module.exports = router;
