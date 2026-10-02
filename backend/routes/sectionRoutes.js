const express = require('express');
const { listSections, listMySections } = require('../controllers/sectionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.get('/', requireAuth, listSections);
router.get('/mine', requireAuth, requireRole('adviser'), listMySections);

module.exports = router;
