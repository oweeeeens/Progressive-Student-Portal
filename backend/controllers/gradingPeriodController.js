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

module.exports = { listCurrent, getCurrentPeriod };
