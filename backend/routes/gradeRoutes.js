// Mounted at /api/grades.
const express = require('express');
const {
  recordGrades,
  getSubmissionsForOffering,
  listSubmittedGrades,
  verifyGrades,
  rejectGrades,
  listPrincipalVerifiedForSection,
  finalizeGrades,
} = require('../controllers/gradeController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth);

// Whoever actually teaches the class offering — not whoever's literal role
// is 'subject_teacher'. class_offerings.teacher_id doesn't require the
// role column to match (an adviser can also teach a class), so gating on
// role here would lock out a legitimate assignment; the real boundary is
// the ownership check inside recordGrades/getSubmissionsForOffering.
router.post('/', requireAuth, recordGrades);
router.get('/by-offering', requireAuth, getSubmissionsForOffering);

// The principal's review queue and verify/reject actions — genuinely
// role-based, unlike the others here: there's no "principal assignment"
// table, it's a single school-wide position, so a literal role check is
// the correct and only boundary.
router.get('/submitted', requireRole('admin', 'principal'), listSubmittedGrades);
router.post('/verify', requireRole('admin', 'principal'), verifyGrades);
router.post('/reject', requireRole('admin', 'principal'), rejectGrades);

// The adviser's review queue (now principal-verified grades only) and
// finalize action for their own section — scoped by sections.adviser_id in
// the controller, not by role label, same reasoning as above.
router.get('/pending', requireAuth, listPrincipalVerifiedForSection);
router.post('/finalize', requireAuth, finalizeGrades);

module.exports = router;
