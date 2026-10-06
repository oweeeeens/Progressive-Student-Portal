const express = require('express');
const {
  listMyClassOfferings,
  getRoster,
  listClassOfferingsForAdmin,
  createClassOffering,
  updateClassOffering,
  deactivateClassOffering,
  reactivateClassOffering,
} = require('../controllers/classOfferingController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

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
router.get('/:id/roster', requireAuth, getRoster);

// Academic Setup — admin only.
router.get('/admin', requireAuth, requireRole('admin'), listClassOfferingsForAdmin);
router.post('/', requireAuth, requireRole('admin'), createClassOffering);
router.put('/:id', requireAuth, requireRole('admin'), updateClassOffering);
router.post('/:id/deactivate', requireAuth, requireRole('admin'), deactivateClassOffering);
router.post('/:id/reactivate', requireAuth, requireRole('admin'), reactivateClassOffering);

module.exports = router;
