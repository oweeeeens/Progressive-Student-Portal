// Mounted at /api/students/:studentId/interventions.
const express = require('express');
const { createIntervention, listForStudent } = require('../controllers/interventionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireRole('admin', 'adviser', 'guidance_counselor'));

router.get('/', listForStudent);
router.post('/', createIntervention);

module.exports = router;
