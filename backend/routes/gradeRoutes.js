// Mounted at /api/grades.
const express = require('express');
const {
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

// There is deliberately no "POST /" any more. A grade used to be typed in
// here; it is now always COMPUTED from the learner's recorded scores and
// submitted through the Class Record (POST /api/class-record/submit — see
// classRecordController.js and DepEd Order No. 015, s. 2026, Annex D).

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
