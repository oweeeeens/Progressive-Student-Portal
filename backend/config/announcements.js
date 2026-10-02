// Announcement attachment settings, kept separate from upload/validation
// logic — mirrors config/enrollment.js's pattern.
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'announcements');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

module.exports = { UPLOAD_DIR, MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES };
