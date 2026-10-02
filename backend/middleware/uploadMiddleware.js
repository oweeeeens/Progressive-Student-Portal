// Configures multer to write enrollment document uploads straight to
// UPLOAD_DIR under a generated filename (never the client-supplied one).
// Wraps multer's callback-style errors (wrong file type, too large) into
// clean 400 JSON responses instead of letting them fall through to the
// generic 500 handler.
const multer = require('multer');
const { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES, UPLOAD_DIR } = require('../config/enrollment');
const { createFileStore } = require('../utils/fileStorage');

const fileStore = createFileStore(UPLOAD_DIR);
fileStore.ensureUploadDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, fileStore.generateStoredFilename(file.mimetype)),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type. Allowed: PDF, JPG, PNG.'));
    }
    cb(null, true);
  },
});

function uploadSingleDocument(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }
    next();
  });
}

module.exports = { uploadSingleDocument, fileStore };
