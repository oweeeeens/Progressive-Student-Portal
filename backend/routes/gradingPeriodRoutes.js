const express = require('express');
const {
  listCurrent,
  getCurrentPeriod,
  listBySchoolYear,
  createGradingPeriod,
  updateGradingPeriod,
} = require('../controllers/gradingPeriodController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
// Who reads and who changes Academic Setup: one list each, config/auth.js.
const { ACADEMIC_SETUP_EDITORS, ACADEMIC_SETUP_READERS } = require('../config/auth');

const router = express.Router();

// Ahead of '/' on principle, consistent with every other list route's
// '/stats'-before-'/:id' convention in this project, even though neither
// path here is a true wildcard today.
router.get('/current', requireAuth, getCurrentPeriod);
router.get('/', requireAuth, listCurrent);

// Academic Setup — admin only.
router.get('/admin', requireAuth, requireRole(...ACADEMIC_SETUP_READERS), listBySchoolYear);
router.post('/', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), createGradingPeriod);
router.put('/:id', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), updateGradingPeriod);

module.exports = router;
