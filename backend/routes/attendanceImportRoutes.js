// Mounted at /api/attendance/bulk-import.
//
// No role middleware here, matching the two attendance routers: it isn't
// literally being an "adviser" that earns write access, it's being that
// section's adviser_id (or that class offering's teacher_id). The controller
// reuses the marking sheets' own ownership checks per request.
const express = require('express');
const {
  parseFile,
  inspectGrid,
  validateImport,
  commitImport,
} = require('../controllers/attendanceImportController');
const { requireAuth } = require('../middleware/authMiddleware');
const { uploadSpreadsheet } = require('../middleware/bulkImportUploadMiddleware');

const router = express.Router();
router.use(requireAuth);

// The first two steps need the file itself; the last two work from the grid
// the browser extracted and sends back.
router.post('/parse', uploadSpreadsheet, parseFile);
router.post('/inspect', uploadSpreadsheet, inspectGrid);
router.post('/validate', validateImport);
router.post('/commit', commitImport);

module.exports = router;
