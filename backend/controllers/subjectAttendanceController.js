// Handlers for per-subject/period attendance, logged by the subject teacher
// who owns the class_offering. Write access: admin, or that teacher.
const subjectAttendanceModel = require('../models/subjectAttendanceModel');
const classOfferingModel = require('../models/classOfferingModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');

const VALID_STATUSES = ['present', 'absent', 'late', 'excused'];

async function assertCanWriteOffering(req, res, classOfferingId) {
  const offering = await classOfferingModel.getById(classOfferingId);
  if (!offering) {
    res.status(400).json({ error: 'classOfferingId does not refer to an existing class.' });
    return null;
  }
  if (req.user.role === 'subject_teacher' && offering.teacher_id !== req.user.id) {
    res.status(403).json({ error: 'You can only record attendance for classes you teach.' });
    return null;
  }
  return offering;
}

async function recordSubjectAttendance(req, res) {
  const { classOfferingId, attendanceDate, entries } = req.body;

  if (!classOfferingId || !attendanceDate || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'classOfferingId, attendanceDate, and a non-empty entries array are required.' });
  }
  const invalidStatus = entries.find((e) => !VALID_STATUSES.includes(e.status));
  if (invalidStatus) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const offering = await assertCanWriteOffering(req, res, classOfferingId);
  if (!offering) return;

  const roster = await subjectAttendanceModel.getActiveStudentsInOffering(classOfferingId);
  const rosterIds = new Set(roster.map((s) => s.id));
  const unknownStudent = entries.find((e) => !rosterIds.has(e.studentId));
  if (unknownStudent) {
    return res.status(400).json({ error: `Student ${unknownStudent.studentId} is not currently in this class.` });
  }

  const gradingPeriod = await gradingPeriodModel.findByDate(attendanceDate);
  if (!gradingPeriod) {
    return res.status(400).json({ error: 'No grading period is configured for that date.' });
  }

  const saved = await subjectAttendanceModel.recordAttendance({
    classOfferingId,
    gradingPeriodId: gradingPeriod.id,
    attendanceDate,
    recordedBy: req.user.id,
    entries,
  });
  res.status(201).json({ records: saved });
}

async function getRosterForDate(req, res) {
  const { classOfferingId, date } = req.query;
  if (!classOfferingId || !date) {
    return res.status(400).json({ error: 'classOfferingId and date query params are required.' });
  }

  const offering = await classOfferingModel.getById(Number(classOfferingId));
  if (!offering) return res.status(404).json({ error: 'Class not found.' });

  const { role, id: userId } = req.user;
  const allowed =
    ['admin', 'registrar', 'guidance_counselor'].includes(role) || (role === 'subject_teacher' && offering.teacher_id === userId);
  if (!allowed) {
    return res.status(403).json({ error: 'You do not have permission to view this class.' });
  }

  const roster = await subjectAttendanceModel.getRosterForDate(Number(classOfferingId), date);
  res.json({ roster });
}

async function getHistoryForStudent(req, res) {
  const { classOfferingId, from, to } = req.query;
  const history = await subjectAttendanceModel.getHistoryForStudent(req.scopedStudent.id, {
    classOfferingId: classOfferingId ? Number(classOfferingId) : undefined,
    from,
    to,
  });
  res.json(history);
}

module.exports = { recordSubjectAttendance, getRosterForDate, getHistoryForStudent };
