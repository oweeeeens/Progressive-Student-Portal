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
  getRisk,
  createStudent,
  updateStudent,
  deactivateStudent,
  reactivateStudent,
  resetPassword,
} = require('../controllers/studentController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
const canWrite = requireRole('admin', 'registrar');

router.use(requireAuth);

router.get('/', listStudents);
// Must stay above '/:id' — otherwise Express matches "stats" as an id.
router.get('/stats', getStats);
router.get('/:id', getStudent);
router.get('/:id/risk', requireRole('admin', 'adviser', 'guidance_counselor'), getRisk);
router.post('/', canWrite, createStudent);
router.patch('/:id', canWrite, updateStudent);
router.delete('/:id', canWrite, deactivateStudent);
router.post('/:id/reactivate', canWrite, reactivateStudent);
router.post('/:id/reset-password', canWrite, resetPassword);

module.exports = router;
