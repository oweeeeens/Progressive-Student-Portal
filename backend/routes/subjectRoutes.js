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
// Who reads and who changes Academic Setup: one list each, config/auth.js.
const { ACADEMIC_SETUP_EDITORS, ACADEMIC_SETUP_READERS } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

// Any authenticated staff member building a class-offering picker.
router.get('/', listActiveSubjects);

// Academic Setup — admin only.
router.get('/admin', requireRole(...ACADEMIC_SETUP_READERS), listSubjectsForAdmin);
router.post('/', requireRole(...ACADEMIC_SETUP_EDITORS), createSubject);
router.put('/:id', requireRole(...ACADEMIC_SETUP_EDITORS), updateSubject);
router.post('/:id/deactivate', requireRole(...ACADEMIC_SETUP_EDITORS), deactivateSubject);
router.post('/:id/reactivate', requireRole(...ACADEMIC_SETUP_EDITORS), reactivateSubject);

module.exports = router;
