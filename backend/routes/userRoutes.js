// Mounted at /api/users. Admin/registrar only.
const express = require('express');
const { listStaff, resetPassword } = require('../controllers/userController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'registrar'));

router.get('/', listStaff);
router.post('/:id/reset-password', resetPassword);

module.exports = router;
