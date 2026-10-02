// Mounted at /api/risk-dashboard. Per the task scope: advisers (own section)
// and guidance counselors (any/all sections), plus admin.
const express = require('express');
const { getDashboard } = require('../controllers/riskDashboardController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'adviser', 'guidance_counselor'), getDashboard);

module.exports = router;
