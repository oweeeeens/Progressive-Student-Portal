const subjectModel = require('../models/subjectModel');

// The picker used when assigning a subject to a class offering.
async function listActiveSubjects(req, res) {
  const subjects = await subjectModel.listActiveSubjects();
  res.json({ subjects });
}

// Admin-only CRUD below — the Academic Setup > Subjects page.
async function listSubjectsForAdmin(req, res) {
  const { search, gradeLevel, includeInactive, page, pageSize } = req.query;
  const result = await subjectModel.listSubjectsForAdmin({
    search,
    gradeLevel: gradeLevel ? Number(gradeLevel) : null,
    includeInactive: includeInactive === 'true',
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 20,
  });
  res.json(result);
}

function validateSubjectBody(body) {
  if (!body.name || !body.name.trim()) return 'name is required.';
  if (body.gradeLevel && ![11, 12].includes(Number(body.gradeLevel))) return 'gradeLevel must be 11 or 12.';
  return null;
}

async function createSubject(req, res) {
  const validationError = validateSubjectBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { name, code, gradeLevel } = req.body;
  try {
    const subject = await subjectModel.createSubject({ name: name.trim(), code, gradeLevel });
    res.status(201).json({ subject });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A subject with this code already exists.' });
    throw err;
  }
}

async function updateSubject(req, res) {
  const validationError = validateSubjectBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { name, code, gradeLevel } = req.body;
  try {
    const subject = await subjectModel.updateSubject(Number(req.params.id), { name: name.trim(), code, gradeLevel });
    if (!subject) return res.status(404).json({ error: 'Subject not found.' });
    res.json({ subject });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A subject with this code already exists.' });
    throw err;
  }
}

async function deactivateSubject(req, res) {
  const id = Number(req.params.id);
  const hasHistory = await subjectModel.subjectHasHistory(id);
  if (hasHistory) {
    return res.status(409).json({
      error: 'This subject already has grades recorded, or still has active class offerings, and cannot be deactivated. Deactivate its class offerings first.',
    });
  }
  const subject = await subjectModel.setSubjectActive(id, false);
  if (!subject) return res.status(404).json({ error: 'Subject not found.' });
  res.json({ subject });
}

async function reactivateSubject(req, res) {
  const subject = await subjectModel.setSubjectActive(Number(req.params.id), true);
  if (!subject) return res.status(404).json({ error: 'Subject not found.' });
  res.json({ subject });
}

module.exports = {
  listActiveSubjects,
  listSubjectsForAdmin,
  createSubject,
  updateSubject,
  deactivateSubject,
  reactivateSubject,
};
