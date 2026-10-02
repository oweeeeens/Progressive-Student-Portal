const express = require('express');
const { listCurrent, getCurrentPeriod } = require('../controllers/gradingPeriodController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// Ahead of '/' on principle, consistent with every other list route's
// '/stats'-before-'/:id' convention in this project, even though neither
// path here is a true wildcard today.
router.get('/current', requireAuth, getCurrentPeriod);
router.get('/', requireAuth, listCurrent);

module.exports = router;
