// Mounted at /api/staff-directory. Every signed-in user, students included;
// what a student receives is narrowed in the controller (no emails).
const express = require('express');
const { getStaffDirectory } = require('../controllers/staffDirectoryController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

router.get('/', getStaffDirectory);

module.exports = router;
