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

const router = express.Router();

// Ahead of '/' on principle, consistent with every other list route's
// '/stats'-before-'/:id' convention in this project, even though neither
// path here is a true wildcard today.
router.get('/current', requireAuth, getCurrentPeriod);
router.get('/', requireAuth, listCurrent);

// Academic Setup — admin only.
router.get('/admin', requireAuth, requireRole('admin'), listBySchoolYear);
router.post('/', requireAuth, requireRole('admin'), createGradingPeriod);
router.put('/:id', requireAuth, requireRole('admin'), updateGradingPeriod);

module.exports = router;
