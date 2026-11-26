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
// Who reads and who changes Academic Setup: one list each, config/auth.js.
const { ACADEMIC_SETUP_EDITORS, ACADEMIC_SETUP_READERS } = require('../config/auth');

const router = express.Router();

router.get('/', requireAuth, listSections);
// No role gate — scoped by actual assignment (adviser_id), not role label;
// see classOfferingRoutes.js's matching comment for why.
router.get('/mine', requireAuth, listMySections);

// Academic Setup — admin only.
router.get('/admin', requireAuth, requireRole(...ACADEMIC_SETUP_READERS), listSectionsForAdmin);
router.post('/', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), createSection);
router.put('/:id', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), updateSection);
router.post('/:id/deactivate', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), deactivateSection);
router.post('/:id/reactivate', requireAuth, requireRole(...ACADEMIC_SETUP_EDITORS), reactivateSection);

module.exports = router;
