// Multer config for the bulk student import upload. Unlike announcements'
// upload (middleware/announcementUploadMiddleware.js), the file itself is
// never kept — it's parsed into rows and discarded — so this uses
// memoryStorage rather than writing to disk, giving the controller a plain
// Buffer (req.file.buffer) with nothing to clean up afterward.
const multer = require('multer');
const { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES } = require('../config/bulkImport');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type. Please upload an .xlsx file.'));
    }
    cb(null, true);
  },
});

function uploadSpreadsheet(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }
    next();
  });
}

module.exports = { uploadSpreadsheet };
