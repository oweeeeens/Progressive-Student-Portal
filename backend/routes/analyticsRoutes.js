// Mounted at /api/analytics. Admin, principal, and guidance_counselor only
// — not adviser or subject_teacher (they keep their existing, narrower,
// per-section/per-class views) and not registrar (manages records/
// accounts, not academic outcomes).
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const {
  getRiskDistribution,
  getRiskTrend,
  getInterventionEffectiveness,
  getAttendanceTrend,
  getTopFactors,
  getFactorsTrend,
  getLowestAttendanceSections,
  exportPdf,
  exportExcel,
} = require('../controllers/analyticsController');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'principal', 'guidance_counselor'));

// Every route here accepts the same four optional filter params —
// sectionId, gradeLevel, strand, riskBand (see parseFilters/filterRows) —
// plus gradingPeriodId on the single-period ones.
router.get('/risk-distribution', getRiskDistribution);
router.get('/risk-trend', getRiskTrend);
router.get('/intervention-effectiveness', getInterventionEffectiveness);
router.get('/attendance-trend', getAttendanceTrend);
router.get('/lowest-attendance-sections', getLowestAttendanceSections);
router.get('/top-factors', getTopFactors);
router.get('/factors-trend', getFactorsTrend);

// Exports of the whole page, scoped by those same filter params. Same
// admin/principal/guidance_counselor gate as every route above, applied by
// the router.use() at the top — a report is the same data in another
// wrapper, so it can't be reachable by anyone who can't already see it.
router.get('/export/pdf', exportPdf);
router.get('/export/excel', exportExcel);

module.exports = router;
