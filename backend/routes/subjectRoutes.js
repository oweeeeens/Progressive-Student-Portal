// Mounted at /api/subjects.
const express = require('express');
const {
  listActiveSubjects,
  listSubjectsForAdmin,
  createSubject,
  updateSubject,
  deactivateSubject,
  reactivateSubject,
} = require('../controllers/subjectController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth);

// Any authenticated staff member building a class-offering picker.
router.get('/', listActiveSubjects);

// Academic Setup — admin only.
router.get('/admin', requireRole('admin'), listSubjectsForAdmin);
router.post('/', requireRole('admin'), createSubject);
router.put('/:id', requireRole('admin'), updateSubject);
router.post('/:id/deactivate', requireRole('admin'), deactivateSubject);
router.post('/:id/reactivate', requireRole('admin'), reactivateSubject);

module.exports = router;
