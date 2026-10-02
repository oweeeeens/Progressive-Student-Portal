// Mounted at /api/enrollment-documents.
const express = require('express');
const {
  listQueue,
  getStats,
  reviewDocument,
  downloadFile,
  deleteDocument,
} = require('../controllers/enrollmentDocumentController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(requireAuth);

// The review queue is a registrar/admin workflow — "show me everything
// awaiting review across all students" — not something a student needs.
router.get('/stats', requireRole('admin', 'registrar'), getStats);
router.get('/', requireRole('admin', 'registrar'), listQueue);
router.patch('/:id/review', requireRole('admin', 'registrar'), reviewDocument);

// Downloading/deleting a specific document is open to student/admin/registrar;
// ownership (is this actually your document, or still pending) is checked
// inside the controller.
router.get('/:id/file', requireRole('student', 'admin', 'registrar'), downloadFile);
router.delete('/:id', requireRole('student', 'admin', 'registrar'), deleteDocument);

module.exports = router;
