// Mounted at /api/interventions.
//
// No role gate: interventions belong to the learner's ADVISER only, which is
// an assignment (sections.adviser_id), not a role — someone advising a
// section may hold the subject_teacher role. The controller and model scope
// every request to the user's advisory learners, so anyone who advises
// nobody gets an empty list and zero counts. See interventionController.js.
const express = require('express');
const { listAll, getStats, updateStatus } = require('../controllers/interventionController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

// Registered ahead of any /:id-shaped route on principle (see studentRoutes'
// equivalent comment) even though /:id/status's extra path segment means
// there's no actual collision with GET /stats today.
router.get('/stats', getStats);
router.get('/', listAll);
router.patch('/:id/status', updateStatus);

module.exports = router;
