// Mounted at /api/attendance/subject. Write access is admin (blanket, by
// role) or the class offering's actual teacher (by assignment —
// class_offerings.teacher_id, not the role column); the real check is in
// assertCanWriteOffering. No role gate here, same reasoning as
// dailyAttendanceRoutes.js: being literally labeled 'subject_teacher' isn't
// what earns write access, being that offering's teacher_id is, and those
// two don't have to match.
const express = require('express');
const { recordSubjectAttendance, getRosterForDate } = require('../controllers/subjectAttendanceController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

router.post('/', recordSubjectAttendance);
router.get('/', getRosterForDate);

module.exports = router;
