// Mounted at /api/school-years. Academic Setup: the admin and the registrar
// write, and the principal reads — they hold the school-wide position, and
// every other Academic Setup page's year filter depends on this list.
const express = require('express');
const {
  listSchoolYears,
  createSchoolYear,
  updateSchoolYear,
  setCurrentSchoolYear,
} = require('../controllers/schoolYearController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
// Who reads and who changes Academic Setup: one list each, config/auth.js.
const { ACADEMIC_SETUP_EDITORS, ACADEMIC_SETUP_READERS } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

// Read: admin, registrar and principal. This used to sit under a blanket
// `router.use(requireRole('admin'))`, which is why it had to be pulled out
// before the principal could see any Academic Setup page at all.
router.get('/', requireRole(...ACADEMIC_SETUP_READERS), listSchoolYears);

// Write: the admin and the registrar — the principal looks, they do not
// restructure the school year.
router.post('/', requireRole(...ACADEMIC_SETUP_EDITORS), createSchoolYear);
router.put('/:id', requireRole(...ACADEMIC_SETUP_EDITORS), updateSchoolYear);
router.post('/:id/set-current', requireRole(...ACADEMIC_SETUP_EDITORS), setCurrentSchoolYear);

module.exports = router;
