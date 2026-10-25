// Mounted at /api/students/bulk-import. Same write-access boundary as the
// rest of Student Records (studentRoutes.js's canWrite) — admin/registrar
// only, since this is just a faster way to do what New Student already lets
// them do one at a time.
const express = require('express');
const { downloadTemplate, parseFile, validateMapping, commitImport } = require('../controllers/bulkImportController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { uploadSpreadsheet } = require('../middleware/bulkImportUploadMiddleware');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'registrar'));

router.get('/template', downloadTemplate);
router.post('/parse', uploadSpreadsheet, parseFile);
router.post('/validate', validateMapping);
router.post('/commit', commitImport);

module.exports = router;
