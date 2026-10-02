// Mounted at /api/grades.
const express = require('express');
const { recordGrades, listDraftsForSection, finalizeGrades } = require('../controllers/gradeController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth);

// Subject teachers enter raw (draft) grades for their own classes.
router.post('/', requireRole('admin', 'subject_teacher'), recordGrades);

// The adviser's review queue and approval action for their own section.
router.get('/pending', requireRole('admin', 'adviser'), listDraftsForSection);
router.post('/finalize', requireRole('admin', 'adviser'), finalizeGrades);

module.exports = router;
