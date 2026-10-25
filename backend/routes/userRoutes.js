// Mounted at /api/users. Admin/registrar only.
const express = require('express');
const {
  listStaff,
  listAccounts,
  getStats,
  updateAccount,
  setAccountActive,
  resetPassword,
  bulkCreateStudentAccounts,
} = require('../controllers/userController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'registrar'));

// Unfiltered staff roster — kept at the bare '/' path other pages already
// depend on (Sections/Class Offerings adviser/teacher pickers); do not widen
// its shape, use the routes below for the full filterable account list.
router.get('/', listStaff);

router.get('/accounts', listAccounts);
router.get('/accounts/stats', getStats);
router.post('/bulk-create-student-accounts', bulkCreateStudentAccounts);
router.patch('/:id', updateAccount);
router.patch('/:id/active', setAccountActive);
router.post('/:id/reset-password', resetPassword);

module.exports = router;
