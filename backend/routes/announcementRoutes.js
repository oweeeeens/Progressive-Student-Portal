// Mounted at /api/announcements. Reads are open to every authenticated
// role (the whole point of a school-wide announcements board); creating is
// restricted to ANNOUNCEMENT_AUTHOR_ROLES at the route level, while
// edit/delete are open to any authenticated role here and narrowed to
// "author or admin" inside the controller (there's no existing record to
// check ownership against until the request names one by id).
const express = require('express');
const { list, create, update, remove, downloadFile } = require('../controllers/announcementController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { uploadOptionalAttachment } = require('../middleware/announcementUploadMiddleware');
const { ANNOUNCEMENT_AUTHOR_ROLES } = require('../config/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', list);
router.post('/', requireRole(...ANNOUNCEMENT_AUTHOR_ROLES), uploadOptionalAttachment, create);
router.patch('/:id', uploadOptionalAttachment, update);
router.delete('/:id', remove);
router.get('/:id/file', downloadFile);

module.exports = router;
