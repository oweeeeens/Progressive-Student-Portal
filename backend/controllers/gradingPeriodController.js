const gradingPeriodModel = require('../models/gradingPeriodModel');

async function listCurrent(req, res) {
  const periods = await gradingPeriodModel.listForCurrentSchoolYear();
  res.json({ gradingPeriods: periods });
}

// The "which term is active right now" indicator on the dashboard — not
// role-gated, any authenticated user may see what term is currently active.
async function getCurrentPeriod(req, res) {
  const period = await gradingPeriodModel.findCurrentWithSchoolYear(new Date().toISOString().slice(0, 10));
  res.json({
    gradingPeriod: period ? { name: period.name, schoolYearLabel: period.school_year_label } : null,
  });
}

// Admin-only below — the Academic Setup > School Years & Grading Periods page.
async function listBySchoolYear(req, res) {
  const { schoolYearId } = req.query;
  if (!schoolYearId) return res.status(400).json({ error: 'schoolYearId query param is required.' });
  const gradingPeriods = await gradingPeriodModel.listBySchoolYear(Number(schoolYearId));
  res.json({ gradingPeriods });
}

function validateGradingPeriodBody(body) {
  const { schoolYearId, name, sequenceNumber, startDate, endDate } = body;
  if (!schoolYearId || !name || !sequenceNumber || !startDate || !endDate) {
    return 'schoolYearId, name, sequenceNumber, startDate, and endDate are required.';
  }
  if (new Date(endDate) <= new Date(startDate)) return 'endDate must be after startDate.';
  return null;
}

async function createGradingPeriod(req, res) {
  const validationError = validateGradingPeriodBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { schoolYearId, name, sequenceNumber, startDate, endDate } = req.body;
  try {
    const gradingPeriod = await gradingPeriodModel.createGradingPeriod({
      schoolYearId: Number(schoolYearId),
      name,
      sequenceNumber: Number(sequenceNumber),
      startDate,
      endDate,
    });
    res.status(201).json({ gradingPeriod });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A grading period with this sequence number already exists for that school year.' });
    }
    throw err;
  }
}

async function updateGradingPeriod(req, res) {
  // schoolYearId is intentionally not editable — a grading period doesn't
  // move between school years, it's recreated in the right one if entered
  // wrong (the same reasoning class offerings/sections apply elsewhere).
  const { name, sequenceNumber, startDate, endDate } = req.body;
  if (!name || !sequenceNumber || !startDate || !endDate) {
    return res.status(400).json({ error: 'name, sequenceNumber, startDate, and endDate are required.' });
  }
  if (new Date(endDate) <= new Date(startDate)) {
    return res.status(400).json({ error: 'endDate must be after startDate.' });
  }
  try {
    const gradingPeriod = await gradingPeriodModel.updateGradingPeriod(Number(req.params.id), {
      name,
      sequenceNumber: Number(sequenceNumber),
      startDate,
      endDate,
    });
    if (!gradingPeriod) return res.status(404).json({ error: 'Grading period not found.' });
    res.json({ gradingPeriod });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A grading period with this sequence number already exists for that school year.' });
    }
    throw err;
  }
}

module.exports = { listCurrent, getCurrentPeriod, listBySchoolYear, createGradingPeriod, updateGradingPeriod };
