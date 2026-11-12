const classOfferingModel = require('../models/classOfferingModel');
const { CLASS_TERMS } = require('../config/academicTerms');

// For a subject teacher building the subject-attendance input sheet: which
// classes do they actually teach, this school year.
// The classes this user may record scores for — the pickers on the Class
// Record and the e-Class Record import. A teacher gets the classes they
// teach; the ADMIN gets every class this year, because the server lets the
// admin act on any class (classRecordController.canWrite). Kept separate
// from /mine, which means "what I teach" (Profile, sidebar counts) and must
// not claim the admin teaches the whole school.
async function listRecordableClassOfferings(req, res) {
  const offerings =
    req.user.role === 'admin' ? await classOfferingModel.listAllCurrent() : await classOfferingModel.listByTeacher(req.user.id);
  res.json({ classOfferings: offerings });
}

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
  const { subjectId, sectionId, teacherId, schoolYearId, term } = body;
  if (!subjectId || !sectionId || !teacherId || !schoolYearId) {
    return 'subjectId, sectionId, teacherId, and schoolYearId are required.';
  }
  // Optional — an omitted term means the whole school year. Checked here as
  // well as by the column's CHECK so a bad value is a sentence, not a 500.
  if (term && !CLASS_TERMS.includes(term)) {
    return `term must be one of: ${CLASS_TERMS.join(', ')}.`;
  }
  return null;
}

async function createClassOffering(req, res) {
  const validationError = validateOfferingBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { subjectId, sectionId, teacherId, schoolYearId, term } = req.body;
  try {
    const offering = await classOfferingModel.createClassOffering({
      subjectId: Number(subjectId),
      sectionId: Number(sectionId),
      teacherId: Number(teacherId),
      schoolYearId: Number(schoolYearId),
      term,
    });
    res.status(201).json({ classOffering: offering });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This subject is already offered to this section for this school year and term.' });
    }
    throw err;
  }
}

async function updateClassOffering(req, res) {
  const validationError = validateOfferingBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { subjectId, sectionId, teacherId, schoolYearId, term } = req.body;
  try {
    const offering = await classOfferingModel.updateClassOffering(Number(req.params.id), {
      subjectId: Number(subjectId),
      sectionId: Number(sectionId),
      teacherId: Number(teacherId),
      schoolYearId: Number(schoolYearId),
      term,
    });
    if (!offering) return res.status(404).json({ error: 'Class offering not found.' });
    res.json({ classOffering: offering });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This subject is already offered to this section for this school year and term.' });
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
  listRecordableClassOfferings,
  listMyClassOfferings,
  getRoster,
  listClassOfferingsForAdmin,
  createClassOffering,
  updateClassOffering,
  deactivateClassOffering,
  reactivateClassOffering,
};
