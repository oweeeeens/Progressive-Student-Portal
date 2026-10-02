// Mounted at /api/students/:studentId/attendance. "Can you see this
// student's attendance history" reuses the same visibility rules as "can you
// see this student's profile" — see middleware/loadScopedStudent.js.
const express = require('express');
const { getHistoryForStudent: getDailyHistory } = require('../controllers/dailyAttendanceController');
const { getHistoryForStudent: getSubjectHistory } = require('../controllers/subjectAttendanceController');
const { requireAuth } = require('../middleware/authMiddleware');
const { loadScopedStudent } = require('../middleware/loadScopedStudent');

const router = express.Router({ mergeParams: true });
router.use(requireAuth, loadScopedStudent);

router.get('/daily', getDailyHistory);
router.get('/subject', getSubjectHistory);

module.exports = router;
