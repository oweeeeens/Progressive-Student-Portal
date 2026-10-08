// Generic "where/how do uploaded files for this module land on disk" —
// shared so announcements (and any future module with attachments) reuse
// the same path-traversal-safe logic instead of duplicating it. The stored filename
// is always generated (never the client-supplied name) — originalFilename
// is kept separately in each module's own DB table purely for display.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXTENSION_BY_MIME_TYPE = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

// Returns a small set of functions bound to one module's upload directory —
// call once per module (e.g. in its multer middleware setup) rather than
// threading uploadDir through every call site.
function createFileStore(uploadDir) {
  function ensureUploadDir() {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  function generateStoredFilename(mimeType) {
    const extension = EXTENSION_BY_MIME_TYPE[mimeType] || '';
    return `${crypto.randomUUID()}${extension}`;
  }

  function absolutePathFor(storedFilename) {
    return path.join(uploadDir, storedFilename);
  }

  function deleteStoredFile(storedFilename) {
    fs.rm(absolutePathFor(storedFilename), { force: true }, () => {}); // best-effort; a missing file isn't an error here
  }

  return { ensureUploadDir, generateStoredFilename, absolutePathFor, deleteStoredFile };
}

module.exports = { createFileStore };
