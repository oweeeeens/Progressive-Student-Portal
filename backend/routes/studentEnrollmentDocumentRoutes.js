// Mounted at /api/students/:studentId/enrollment-documents. Only the
// student themselves, or admin/registrar, have any business here — other
// roles (adviser, subject_teacher, guidance_counselor) are excluded entirely,
// per this module's narrower scope (see enrollmentDocumentController.js).
const express = require('express');
const { uploadDocument, listForStudent } = require('../controllers/enrollmentDocumentController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { uploadSingleDocument } = require('../middleware/uploadMiddleware');

const router = express.Router({ mergeParams: true });
router.use(requireAuth, requireRole('student', 'admin', 'registrar'));

router.get('/', listForStudent);
router.post('/', uploadSingleDocument, uploadDocument);

module.exports = router;
