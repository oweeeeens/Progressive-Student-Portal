// Handlers for announcements. Visible to every authenticated role on read;
// write access is role-gated at the route level (ANNOUNCEMENT_AUTHOR_ROLES)
// for create, and author-or-admin here for edit/delete.
const announcementModel = require('../models/announcementModel');
const { fileStore } = require('../middleware/announcementUploadMiddleware');

const MAX_TITLE_LENGTH = 255;

function canModify(user, announcement) {
  return user.role === 'admin' || user.id === announcement.posted_by;
}

async function list(req, res) {
  const { page, pageSize } = req.query;
  const result = await announcementModel.list({
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });
  res.json(result);
}

async function create(req, res) {
  const { title, body } = req.body;

  const cleanupAndRespond = (status, payload) => {
    if (req.file) fileStore.deleteStoredFile(req.file.filename);
    return res.status(status).json(payload);
  };

  if (!title || !title.trim() || !body || !body.trim()) {
    return cleanupAndRespond(400, { error: 'title and body are required.' });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return cleanupAndRespond(400, { error: `title must be ${MAX_TITLE_LENGTH} characters or fewer.` });
  }

  const id = await announcementModel.create({
    title: title.trim(),
    body,
    filePath: req.file?.filename,
    originalFilename: req.file?.originalname,
    postedBy: req.user.id,
  });
  const announcement = await announcementModel.getById(id);
  res.status(201).json({ announcement });
}

async function update(req, res) {
  const existing = await announcementModel.getById(Number(req.params.id));

  const cleanupAndRespond = (status, payload) => {
    if (req.file) fileStore.deleteStoredFile(req.file.filename);
    return res.status(status).json(payload);
  };

  if (!existing) return cleanupAndRespond(404, { error: 'Announcement not found.' });
  if (!canModify(req.user, existing)) {
    return cleanupAndRespond(403, { error: 'You can only edit your own announcements.' });
  }

  const { title, body } = req.body;
  if (title !== undefined && (!title.trim() || title.length > MAX_TITLE_LENGTH)) {
    return cleanupAndRespond(400, { error: `title must be 1-${MAX_TITLE_LENGTH} characters.` });
  }
  if (body !== undefined && !body.trim()) {
    return cleanupAndRespond(400, { error: 'body cannot be empty.' });
  }

  const updateData = {};
  if (title !== undefined) updateData.title = title.trim();
  if (body !== undefined) updateData.body = body;
  // A newly-uploaded file replaces the old one on disk; the old one is only
  // deleted after the DB write succeeds, so a failed update never leaves an
  // announcement pointing at a file that no longer exists.
  if (req.file) {
    updateData.filePath = req.file.filename;
    updateData.originalFilename = req.file.originalname;
  }

  await announcementModel.update(existing.id, updateData);
  if (req.file && existing.file_path) {
    fileStore.deleteStoredFile(existing.file_path);
  }

  const announcement = await announcementModel.getById(existing.id);
  res.json({ announcement });
}

async function remove(req, res) {
  const existing = await announcementModel.getById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
  if (!canModify(req.user, existing)) {
    return res.status(403).json({ error: 'You can only delete your own announcements.' });
  }

  const deleted = await announcementModel.remove(existing.id);
  if (deleted.file_path) fileStore.deleteStoredFile(deleted.file_path);
  res.status(204).end();
}

async function downloadFile(req, res) {
  const announcement = await announcementModel.getById(Number(req.params.id));
  if (!announcement || !announcement.file_path) {
    return res.status(404).json({ error: 'Attachment not found.' });
  }

  res.download(fileStore.absolutePathFor(announcement.file_path), announcement.original_filename, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File not found on disk.' });
    }
  });
}

module.exports = { list, create, update, remove, downloadFile };
