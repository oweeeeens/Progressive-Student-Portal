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

module.exports = { listSections, listMySections };
