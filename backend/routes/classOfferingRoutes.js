const express = require('express');
const {
  listMyClassOfferings,
  listRecordableClassOfferings,
  listCurrentClassOfferings,
  getRoster,
  listClassOfferingsForAdmin,
  createClassOffering,
  updateClassOffering,
  deactivateClassOffering,
  reactivateClassOffering,
} = require('../controllers/classOfferingController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
// Who reads and who changes Academic Setup: one list each, config/auth.js.
const { ACADEMIC_SETUP_EDITORS, ACADEMIC_SETUP_READERS, ALL_GRADE_REPORT_READERS } = require('../config/auth');

const router = express.Router();

// No role gate on either of these — both are scoped by actual assignment
// (teacher_id), not by role label, in the controller/model. A role gate
// here would be wrong twice over: too narrow (locks out anyone whose
// primary role isn't literally 'subject_teacher' but who is genuinely
// assigned to teach a class — sections.adviser_id and class_offerings.
// teacher_id don't require the role column to match) and redundant with
// the real check. See getRoster's ownership check for the actual security
// boundary.
router.get('/mine', requireAuth, listMyClassOfferings);
router.get('/recordable', requireAuth, listRecordableClassOfferings);
// Every current class, read-only — the class grade report's picker for the
// roles that read every class's report (admin, registrar). NOT the same as
// /recordable, which lists the classes a user may enter scores in.
router.get('/current', requireAuth, requireRole(...ALL_GRADE_REPORT_READERS), listCurrentClassOfferings);
router.get('/:id/roster', requireAuth, getRoster);

// Academic Setup — admin only.
router.get('/admin', requireAuth, requireRole(...ACADEMIC_SETUP_READERS), listClassOfferingsForAdmin);
router.post('/', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), createClassOffering);
router.put('/:id', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), updateClassOffering);
router.post('/:id/deactivate', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), deactivateClassOffering);
router.post('/:id/reactivate', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), reactivateClassOffering);

module.exports = router;
