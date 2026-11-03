// Mounted at /api/school-years. Academic Setup: admin writes, and the
// principal reads — they hold the school-wide position, and every other
// Academic Setup page's year filter depends on this list.
const express = require('express');
const {
  listSchoolYears,
  createSchoolYear,
  updateSchoolYear,
  setCurrentSchoolYear,
} = require('../controllers/schoolYearController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth);

// Read: admin and principal. This used to sit under a blanket
// `router.use(requireRole('admin'))`, which is why it had to be pulled out
// before the principal could see any Academic Setup page at all.
router.get('/', requireRole('admin', 'principal'), listSchoolYears);

// Write stays admin-only — the principal looks, they do not restructure the
// school year.
router.post('/', requireRole('admin'), createSchoolYear);
router.put('/:id', requireRole('admin'), updateSchoolYear);
router.post('/:id/set-current', requireRole('admin'), setCurrentSchoolYear);

module.exports = router;
