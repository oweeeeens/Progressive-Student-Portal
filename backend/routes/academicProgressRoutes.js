// Mounted at /api/academic-progress (formerly /api/risk-dashboard). Same
// audience as before: admin, adviser, guidance_counselor.
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { getAcademicProgress } = require('../controllers/academicProgressController');

const router = express.Router();
// The principal reads this school-wide. They already see its aggregate on
// the Analytics dashboard, and may already open any single student's
// academic progress (studentRoutes.js) — so the list sitting between the
// rollup and the detail was the only thing closed to them, which was an
// accident of this list rather than a policy. Logging interventions stays
// with advisers and guidance counselors (interventionRoutes.js).
router.get('/', requireAuth, requireRole('admin', 'principal', 'adviser', 'guidance_counselor'), getAcademicProgress);

module.exports = router;
