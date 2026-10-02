// Mounted at /api/attendance/subject. Write restricted to admin/subject_teacher
// (ownership of the class_offering is checked in the controller).
const express = require('express');
const { recordSubjectAttendance, getRosterForDate } = require('../controllers/subjectAttendanceController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth);

router.post('/', requireRole('admin', 'subject_teacher'), recordSubjectAttendance);
router.get('/', getRosterForDate);

module.exports = router;
