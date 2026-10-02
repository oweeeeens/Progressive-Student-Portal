// Mounted at /api/attendance/daily. Write restricted to admin/registrar/
// adviser (ownership of the section is checked in the controller); reads
// are open to any authenticated role and scoped per-request in the controller.
const express = require('express');
const { recordDailyAttendance, getRosterForDate } = require('../controllers/dailyAttendanceController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth);

router.post('/', requireRole('admin', 'registrar', 'adviser'), recordDailyAttendance);
router.get('/', getRosterForDate);

module.exports = router;
