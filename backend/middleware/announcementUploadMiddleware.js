// Multer config for announcement attachments, pointed at announcements'
// own upload directory (see utils/fileStorage.js for the shared disk-storage
// helper). The attachment is optional on an announcement, so this doesn't
// 400 when no file is present — that's left to the controller to decide.
const multer = require('multer');
const { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES, UPLOAD_DIR } = require('../config/announcements');
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

function uploadOptionalAttachment(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }
    next();
  });
}

module.exports = { uploadOptionalAttachment, fileStore };
