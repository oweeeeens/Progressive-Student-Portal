const dashboardModel = require('../models/dashboardModel');
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

module.exports = { getStats, getActivity, getAttention };
