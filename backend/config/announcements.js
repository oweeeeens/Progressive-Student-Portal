// Announcement attachment settings, kept separate from upload/validation
// logic — mirrors config/enrollment.js's pattern.
const path = require('path');

// A deployed container's filesystem is wiped on every redeploy, so in
// production this points at a mounted volume instead (UPLOADS_ROOT=/data,
// say) and attachments survive. Locally it stays backend/uploads, which is
// gitignored.
const UPLOADS_ROOT = process.env.UPLOADS_ROOT || path.join(__dirname, '..', 'uploads');
const UPLOAD_DIR = path.join(UPLOADS_ROOT, 'announcements');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

module.exports = { UPLOAD_DIR, MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES };
