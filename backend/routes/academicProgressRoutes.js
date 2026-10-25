// Mounted at /api/academic-progress (formerly /api/risk-dashboard). Same
// audience as before: admin, adviser, guidance_counselor.
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { getAcademicProgress } = require('../controllers/academicProgressController');

const router = express.Router();
router.get('/', requireAuth, requireRole('admin', 'adviser', 'guidance_counselor'), getAcademicProgress);

module.exports = router;
