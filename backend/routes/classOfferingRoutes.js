const express = require('express');
const { listMyClassOfferings, getRoster } = require('../controllers/classOfferingController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('subject_teacher'), listMyClassOfferings);
router.get('/:id/roster', requireAuth, requireRole('admin', 'subject_teacher'), getRoster);

module.exports = router;
