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
  if (req.user.role === 'subject_teacher' && offering.teacher_id !== req.user.id) {
    return res.status(403).json({ error: 'You do not have permission to view this class.' });
  }

  const roster = await classOfferingModel.getActiveStudentsInOffering(offering.id);
  res.json({ roster });
}

module.exports = { listMyClassOfferings, getRoster };
