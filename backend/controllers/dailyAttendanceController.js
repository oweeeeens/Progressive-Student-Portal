// Handlers for the adviser's daily/homeroom attendance register (SF2).
// Write access: admin, registrar, or the adviser who owns the section.
const dailyAttendanceModel = require('../models/dailyAttendanceModel');
const sectionModel = require('../models/sectionModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const classOfferingModel = require('../models/classOfferingModel');
const riskEngine = require('../services/riskEngine');

const VALID_STATUSES = ['present', 'absent', 'late', 'excused'];

async function assertCanWriteSection(req, res, sectionId) {
  const section = await sectionModel.getSectionById(sectionId);
  if (!section) {
    res.status(400).json({ error: 'sectionId does not refer to an existing section.' });
    return null;
  }
  // admin/registrar have blanket write access by role; everyone else must
  // actually be this section's adviser_id regardless of their role label —
  // see gradeController's matching comments for the full reasoning.
  if (!['admin', 'registrar'].includes(req.user.role) && section.adviser_id !== req.user.id) {
    res.status(403).json({ error: 'You can only record attendance for your own advisory section.' });
    return null;
  }
  return section;
}

async function recordDailyAttendance(req, res) {
  const { sectionId, attendanceDate, entries } = req.body;

  if (!sectionId || !attendanceDate || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'sectionId, attendanceDate, and a non-empty entries array are required.' });
  }
  const invalidStatus = entries.find((e) => !VALID_STATUSES.includes(e.status));
  if (invalidStatus) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const section = await assertCanWriteSection(req, res, sectionId);
  if (!section) return;

  const roster = await dailyAttendanceModel.getActiveStudentsInSection(sectionId);
  const rosterIds = new Set(roster.map((s) => s.id));
  const unknownStudent = entries.find((e) => !rosterIds.has(e.studentId));
  if (unknownStudent) {
    return res.status(400).json({ error: `Student ${unknownStudent.studentId} is not currently in this section.` });
  }

  const gradingPeriod = await gradingPeriodModel.findByDate(attendanceDate);
  if (!gradingPeriod) {
    return res.status(400).json({ error: 'No grading period is configured for that date.' });
  }

  const saved = await dailyAttendanceModel.recordAttendance({
    gradingPeriodId: gradingPeriod.id,
    attendanceDate,
    recordedBy: req.user.id,
    entries,
  });

  // Daily attendance is the authoritative data source for the risk formula's
  // attendance rate (see schema notes on daily_attendance_records) — a new
  // submission can change that rate, so recalculate immediately for exactly
  // the students just marked.
  const affectedStudentIds = [...new Set(saved.map((r) => r.student_id))];
  await riskEngine.recalculateRiskForStudents(affectedStudentIds, gradingPeriod.id);

  res.status(201).json({ records: saved });
}

async function getRosterForDate(req, res) {
  const { sectionId, date } = req.query;
  if (!sectionId || !date) {
    return res.status(400).json({ error: 'sectionId and date query params are required.' });
  }

  const section = await sectionModel.getSectionById(Number(sectionId));
  if (!section) return res.status(404).json({ error: 'Section not found.' });

  // Reading the roster requires the same visibility as reading its
  // students: unrestricted roles, the section's own adviser, or a subject
  // teacher who actually teaches into this section.
  const { role, id: userId } = req.user;
  const allowed =
    ['admin', 'registrar', 'guidance_counselor'].includes(role) ||
    section.adviser_id === userId ||
    (await classOfferingModel.teacherTeachesSection(userId, section.id));
  if (!allowed) {
    return res.status(403).json({ error: 'You do not have permission to view this section.' });
  }

  const roster = await dailyAttendanceModel.getRosterForDate(Number(sectionId), date);
  res.json({ roster });
}

async function getHistoryForStudent(req, res) {
  const { from, to } = req.query;
  const history = await dailyAttendanceModel.getHistoryForStudent(req.scopedStudent.id, { from, to });
  res.json(history);
}

module.exports = { recordDailyAttendance, getRosterForDate, getHistoryForStudent };
