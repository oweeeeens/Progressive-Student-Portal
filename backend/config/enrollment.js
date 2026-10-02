// Enrollment document settings, kept separate from upload/validation logic
// so the required document list or file limits can be adjusted in one place.
const path = require('path');

// Scope: "digital document upload only" per CLAUDE.md — these are the three
// documents the client's Phase 1 scope requires. 'other' also exists in the
// schema's enum for anything outside this list, but isn't "required."
const REQUIRED_DOCUMENT_TYPES = ['report_card', 'birth_certificate', 'sf10'];

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'enrollment-documents');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — scanned documents/photos
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

module.exports = { REQUIRED_DOCUMENT_TYPES, UPLOAD_DIR, MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES };
