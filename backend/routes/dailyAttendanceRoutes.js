// Mounted at /api/attendance/daily. Write access is admin/registrar (both
// blanket, by role) or the section's actual adviser (by assignment —
// sections.adviser_id, not the role column); the real check is in
// assertCanWriteSection. No role gate here: it isn't literally 'adviser'
// that earns write access, it's being that section's adviser_id, which
// doesn't require the role column to match (an adviser can also be
// assigned to teach a class elsewhere, and vice versa). Reads are open to
// any authenticated role and scoped per-request in the controller.
const express = require('express');
const { recordDailyAttendance, getRosterForDate } = require('../controllers/dailyAttendanceController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

router.post('/', recordDailyAttendance);
router.get('/', getRosterForDate);

module.exports = router;
