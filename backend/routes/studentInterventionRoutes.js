// Mounted at /api/students/:studentId/interventions.
//
// No role gate: only the adviser of this learner's section may read or log
// their interventions, and that is an assignment, not a role — the
// controller checks it (interventionController.resolveAdvisedStudent).
const express = require('express');
const { createIntervention, listForStudent } = require('../controllers/interventionController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', listForStudent);
router.post('/', createIntervention);

module.exports = router;
