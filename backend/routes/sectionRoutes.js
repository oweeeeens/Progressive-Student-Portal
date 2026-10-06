const express = require('express');
const {
  listSections,
  listMySections,
  listSectionsForAdmin,
  createSection,
  updateSection,
  deactivateSection,
  reactivateSection,
} = require('../controllers/sectionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.get('/', requireAuth, listSections);
// No role gate — scoped by actual assignment (adviser_id), not role label;
// see classOfferingRoutes.js's matching comment for why.
router.get('/mine', requireAuth, listMySections);

// Academic Setup — admin only.
router.get('/admin', requireAuth, requireRole('admin'), listSectionsForAdmin);
router.post('/', requireAuth, requireRole('admin'), createSection);
router.put('/:id', requireAuth, requireRole('admin'), updateSection);
router.post('/:id/deactivate', requireAuth, requireRole('admin'), deactivateSection);
router.post('/:id/reactivate', requireAuth, requireRole('admin'), reactivateSection);

module.exports = router;
