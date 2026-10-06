const schoolYearModel = require('../models/schoolYearModel');

async function listSchoolYears(req, res) {
  const schoolYears = await schoolYearModel.listSchoolYears();
  res.json({ schoolYears });
}

function validateSchoolYearBody(body) {
  const { label, startDate, endDate } = body;
  if (!label || !startDate || !endDate) return 'label, startDate, and endDate are required.';
  if (new Date(endDate) <= new Date(startDate)) return 'endDate must be after startDate.';
  return null;
}

async function createSchoolYear(req, res) {
  const validationError = validateSchoolYearBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { label, startDate, endDate } = req.body;
  try {
    const schoolYear = await schoolYearModel.createSchoolYear({ label, startDate, endDate });
    res.status(201).json({ schoolYear });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A school year with this label already exists.' });
    throw err;
  }
}

async function updateSchoolYear(req, res) {
  const validationError = validateSchoolYearBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { label, startDate, endDate } = req.body;
  try {
    const schoolYear = await schoolYearModel.updateSchoolYear(Number(req.params.id), { label, startDate, endDate });
    if (!schoolYear) return res.status(404).json({ error: 'School year not found.' });
    res.json({ schoolYear });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A school year with this label already exists.' });
    throw err;
  }
}

async function setCurrentSchoolYear(req, res) {
  const schoolYear = await schoolYearModel.setCurrentSchoolYear(Number(req.params.id));
  if (!schoolYear) return res.status(404).json({ error: 'School year not found.' });
  res.json({ schoolYear });
}

module.exports = { listSchoolYears, createSchoolYear, updateSchoolYear, setCurrentSchoolYear };
