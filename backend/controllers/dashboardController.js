const dashboardModel = require('../models/dashboardModel');
const dashboardQueueModel = require('../models/dashboardQueueModel');
const activityModel = require('../models/activityModel');

async function getStats(req, res) {
  const stats = await dashboardModel.getStats(req.user);
  res.json({ stats });
}

async function getActivity(req, res) {
  const activity = await activityModel.getRecentActivity(req.user);
  res.json({ activity });
}

async function getAttention(req, res) {
  const students = await dashboardModel.getTopAtRiskStudents(req.user);
  res.json({ students });
}

// "What needs you today" — the home page's lead. Shaped by what this person
// is assigned to, not by their role label; see models/dashboardQueueModel.js.
// Every role may call it, and a role with no queue simply gets an empty list.
async function getQueue(req, res) {
  const queue = await dashboardQueueModel.getTaskQueue(req.user);
  res.json(queue);
}

// Band distribution per grading period for this person's own scope — the
// chart on the home page, and the trend view on Academic Progress Tracking.
// Scoped in the model, so a role with no risk scope gets an empty list
// rather than a permission error.
//
// `sectionId` only ever NARROWS what the caller could already see (see
// getBandTrend), so it needs no gate here: asking for a section outside
// your scope returns nothing rather than someone else's learners.
async function getBands(req, res) {
  const bands = await dashboardModel.getBandTrend(req.user, { sectionId: req.query.sectionId });
  res.json(bands);
}

module.exports = { getStats, getActivity, getAttention, getQueue, getBands };
