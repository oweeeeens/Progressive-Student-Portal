const classOfferingModel = require('../models/classOfferingModel');

// For a subject teacher building the subject-attendance input sheet: which
// classes do they actually teach, this school year.
async function listMyClassOfferings(req, res) {
  const offerings = await classOfferingModel.listByTeacher(req.user.id);
  res.json({ classOfferings: offerings });
}

// For the grade-entry input sheet: which students are in this class right now.
async function getRoster(req, res) {
  const offering = await classOfferingModel.getById(Number(req.params.id));
  if (!offering) return res.status(404).json({ error: 'Class not found.' });
  // Ownership by assignment (teacher_id), not by role label — admin
  // bypasses, everyone else must actually be this offering's teacher
  // regardless of what their role column says.
  if (req.user.role !== 'admin' && offering.teacher_id !== req.user.id) {
    return res.status(403).json({ error: 'You do not have permission to view this class.' });
  }

  const roster = await classOfferingModel.getActiveStudentsInOffering(offering.id);
  res.json({ roster });
}

// Admin-only CRUD below — the Academic Setup > Class Offerings page.
async function listClassOfferingsForAdmin(req, res) {
  const { search, schoolYearId, sectionId, subjectId, includeInactive, page, pageSize } = req.query;
  const result = await classOfferingModel.listClassOfferingsForAdmin({
    search,
    schoolYearId: schoolYearId ? Number(schoolYearId) : null,
    sectionId: sectionId ? Number(sectionId) : null,
    subjectId: subjectId ? Number(subjectId) : null,
    includeInactive: includeInactive === 'true',
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 20,
  });
  res.json(result);
}

function validateOfferingBody(body) {
  const { subjectId, sectionId, teacherId, schoolYearId } = body;
  if (!subjectId || !sectionId || !teacherId || !schoolYearId) {
    return 'subjectId, sectionId, teacherId, and schoolYearId are required.';
  }
  return null;
}

async function createClassOffering(req, res) {
  const validationError = validateOfferingBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { subjectId, sectionId, teacherId, schoolYearId } = req.body;
  try {
    const offering = await classOfferingModel.createClassOffering({
      subjectId: Number(subjectId),
      sectionId: Number(sectionId),
      teacherId: Number(teacherId),
      schoolYearId: Number(schoolYearId),
    });
    res.status(201).json({ classOffering: offering });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This subject is already offered to this section for this school year.' });
    }
    throw err;
  }
}

async function updateClassOffering(req, res) {
  const validationError = validateOfferingBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { subjectId, sectionId, teacherId, schoolYearId } = req.body;
  try {
    const offering = await classOfferingModel.updateClassOffering(Number(req.params.id), {
      subjectId: Number(subjectId),
      sectionId: Number(sectionId),
      teacherId: Number(teacherId),
      schoolYearId: Number(schoolYearId),
    });
    if (!offering) return res.status(404).json({ error: 'Class offering not found.' });
    res.json({ classOffering: offering });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This subject is already offered to this section for this school year.' });
    }
    throw err;
  }
}

async function deactivateClassOffering(req, res) {
  const id = Number(req.params.id);
  const hasHistory = await classOfferingModel.classOfferingHasHistory(id);
  if (hasHistory) {
    return res.status(409).json({ error: 'This class offering already has grades recorded and cannot be deactivated.' });
  }
  const offering = await classOfferingModel.setClassOfferingActive(id, false);
  if (!offering) return res.status(404).json({ error: 'Class offering not found.' });
  res.json({ classOffering: offering });
}

async function reactivateClassOffering(req, res) {
  const offering = await classOfferingModel.setClassOfferingActive(Number(req.params.id), true);
  if (!offering) return res.status(404).json({ error: 'Class offering not found.' });
  res.json({ classOffering: offering });
}

module.exports = {
  listMyClassOfferings,
  getRoster,
  listClassOfferingsForAdmin,
  createClassOffering,
  updateClassOffering,
  deactivateClassOffering,
  reactivateClassOffering,
};
