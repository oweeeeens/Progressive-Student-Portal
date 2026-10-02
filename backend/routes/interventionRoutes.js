// Mounted at /api/interventions.
const express = require('express');
const { listAll, getStats, updateStatus } = require('../controllers/interventionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'adviser', 'guidance_counselor'));

// Registered ahead of any /:id-shaped route on principle (see studentRoutes'
// equivalent comment) even though /:id/status's extra path segment means
// there's no actual collision with GET /stats today.
router.get('/stats', getStats);
router.get('/', listAll);
router.patch('/:id/status', updateStatus);

module.exports = router;
