const sectionModel = require('../models/sectionModel');

async function listSections(req, res) {
  const sections = await sectionModel.listSections();
  res.json({ sections });
}

// For an adviser building the daily-attendance input sheet: which
// section(s) do they actually advise, this school year.
async function listMySections(req, res) {
  const sections = await sectionModel.listSectionsByAdviser(req.user.id);
  res.json({ sections });
}

// Admin-only CRUD below — the Academic Setup > Sections page.
async function listSectionsForAdmin(req, res) {
  const { search, gradeLevel, schoolYearId, includeInactive, page, pageSize } = req.query;
  const result = await sectionModel.listSectionsForAdmin({
    search,
    gradeLevel: gradeLevel ? Number(gradeLevel) : null,
    schoolYearId: schoolYearId ? Number(schoolYearId) : null,
    includeInactive: includeInactive === 'true',
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 20,
  });
  res.json(result);
}

function validateSectionBody(body) {
  const { schoolYearId, gradeLevel, name, adviserId } = body;
  if (!schoolYearId || !gradeLevel || !name || !adviserId) {
    return 'schoolYearId, gradeLevel, name, and adviserId are required.';
  }
  if (![11, 12].includes(Number(gradeLevel))) {
    return 'gradeLevel must be 11 or 12.';
  }
  return null;
}

async function createSection(req, res) {
  const validationError = validateSectionBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { schoolYearId, gradeLevel, strand, name, adviserId } = req.body;
  try {
    const section = await sectionModel.createSection({
      schoolYearId: Number(schoolYearId),
      gradeLevel: Number(gradeLevel),
      strand,
      name,
      adviserId: Number(adviserId),
    });
    res.status(201).json({ section });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A section with this name/grade level already exists for that school year.' });
    }
    throw err;
  }
}

async function updateSection(req, res) {
  const validationError = validateSectionBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { schoolYearId, gradeLevel, strand, name, adviserId } = req.body;
  try {
    const section = await sectionModel.updateSection(Number(req.params.id), {
      schoolYearId: Number(schoolYearId),
      gradeLevel: Number(gradeLevel),
      strand,
      name,
      adviserId: Number(adviserId),
    });
    if (!section) return res.status(404).json({ error: 'Section not found.' });
    res.json({ section });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A section with this name/grade level already exists for that school year.' });
    }
    throw err;
  }
}

async function deactivateSection(req, res) {
  const id = Number(req.params.id);
  const hasHistory = await sectionModel.sectionHasHistory(id);
  if (hasHistory) {
    return res.status(409).json({
      error: 'This section already has grades or attendance recorded against it and cannot be deactivated. Reassign its students first if it is no longer in use.',
    });
  }
  const section = await sectionModel.setSectionActive(id, false);
  if (!section) return res.status(404).json({ error: 'Section not found.' });
  res.json({ section });
}

async function reactivateSection(req, res) {
  const section = await sectionModel.setSectionActive(Number(req.params.id), true);
  if (!section) return res.status(404).json({ error: 'Section not found.' });
  res.json({ section });
}

module.exports = {
  listSections,
  listMySections,
  listSectionsForAdmin,
  createSection,
  updateSection,
  deactivateSection,
  reactivateSection,
};
