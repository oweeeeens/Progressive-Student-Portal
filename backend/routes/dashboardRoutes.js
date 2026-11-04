// Mounted at /api/dashboard. Open to every authenticated role — the stats,
// activity, and attention-list contents are all role-scoped in their
// respective models, so each role only gets data it's already allowed to
// see elsewhere in the app.
const express = require('express');
const { getStats, getActivity, getAttention, getQueue, getBands } = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/stats', requireAuth, getStats);
router.get('/activity', requireAuth, getActivity);
router.get('/attention', requireAuth, getAttention);
router.get('/queue', requireAuth, getQueue);
router.get('/bands', requireAuth, getBands);

module.exports = router;
