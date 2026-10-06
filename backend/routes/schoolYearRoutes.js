// Mounted at /api/school-years. Admin-only — Academic Setup.
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
router.use(requireAuth, requireRole('admin'));

router.get('/', listSchoolYears);
router.post('/', createSchoolYear);
router.put('/:id', updateSchoolYear);
router.post('/:id/set-current', setCurrentSchoolYear);

module.exports = router;
