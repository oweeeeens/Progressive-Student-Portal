// Mounted at /api/students/:studentId/grades — same visibility rule as
// Student Records (see middleware/loadScopedStudent.js).
const express = require('express');
const { getHistoryForStudent } = require('../controllers/gradeController');
const { requireAuth } = require('../middleware/authMiddleware');
const { loadScopedStudent } = require('../middleware/loadScopedStudent');

const router = express.Router({ mergeParams: true });
router.use(requireAuth, loadScopedStudent);

router.get('/', getHistoryForStudent);

module.exports = router;
