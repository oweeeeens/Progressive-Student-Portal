// Mounted at /api/students/:studentId/attendance. "Can you see this
// student's attendance history" reuses the same visibility rules as "can you
// see this student's profile" — see middleware/loadScopedStudent.js.
//
// Daily (SF2) attendance only. A subject-level register existed until
// 2026-11-11 and was removed to keep the System to its title: it never fed
// the risk score, which reads the adviser's daily record alone.
const express = require('express');
const { getHistoryForStudent: getDailyHistory } = require('../controllers/dailyAttendanceController');
const { requireAuth } = require('../middleware/authMiddleware');
const { loadScopedStudent } = require('../middleware/loadScopedStudent');

const router = express.Router({ mergeParams: true });
router.use(requireAuth, loadScopedStudent);

router.get('/daily', getDailyHistory);

module.exports = router;
