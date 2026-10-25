// Mounted at /api/my-progress — the student self-service view. Role-gated
// to 'student' only, not "any authenticated user": staff already have
// their own, differently-shaped views of this same data (the Academic
// Progress Tracking dashboard, the Student Detail badge, the Interventions
// page) and have no reason to hit a route whose whole point is "no :id
// param, always resolves to the caller's own record."
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const {
  getMyAcademicProgress,
  getMyProgressTrend,
  getMySubjects,
  getMySubjectAttendance,
  getMySubjectGrades,
  getMyAttendanceDetail,
  getMyInterventions,
} = require('../controllers/myProgressController');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/academic-progress', getMyAcademicProgress);
router.get('/trend', getMyProgressTrend);
router.get('/subjects', getMySubjects);
router.get('/subject-attendance', getMySubjectAttendance);
router.get('/subject-grades', getMySubjectGrades);
router.get('/attendance-detail', getMyAttendanceDetail);
router.get('/interventions', getMyInterventions);

module.exports = router;
