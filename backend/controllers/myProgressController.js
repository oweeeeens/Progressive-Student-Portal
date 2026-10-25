// "My Progress" — the student self-service view of Academic Progress
// Tracking. Deliberately a separate controller/response shape from
// academicProgressController.js, not the same endpoint with role-based
// field-stripping: that would mean remembering, every time that file
// changes, to also check what a student is and isn't allowed to see.
// Here, the smaller/reworded shape is the ONLY shape — there's nothing to
// accidentally leak.
//
// No :id param anywhere in this router — every handler resolves "this
// student's own record" from req.user via studentModel.listStudents' own
// appendScopeClause rule (role === 'student' -> s.user_id = req.user.id),
// the same scoping rule used everywhere else in the app. That, plus the
// route-level requireRole('student') in routes/myProgressRoutes.js, is what
// makes "only ever your own data" structural rather than a check someone
// could forget to add to a new endpoint later.
const studentModel = require('../models/studentModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const riskAssessmentModel = require('../models/riskAssessmentModel');
const interventionModel = require('../models/interventionModel');
const gradeModel = require('../models/gradeModel');
const dailyAttendanceModel = require('../models/dailyAttendanceModel');
const subjectAttendanceModel = require('../models/subjectAttendanceModel');
const classOfferingModel = require('../models/classOfferingModel');
const { buildStudentAcademicProgress, determineBand } = require('../services/academicProgressCalculator');
const { BAND_LABELS } = require('../config/academicProgress');
const { GRADE_AT_RISK_THRESHOLD, ATTENDANCE_RISK_THRESHOLD } = require('../config/riskConfig');

async function getOwnStudentRecord(req) {
  const result = await studentModel.listStudents(req.user, { pageSize: 1 });
  return result.students[0] || null;
}

async function getMyAcademicProgress(req, res) {
  const student = await getOwnStudentRecord(req);
  if (!student) return res.status(404).json({ error: 'No student record is linked to this account.' });

  const currentPeriod = await gradingPeriodModel.findByDate(new Date().toISOString().slice(0, 10));
  if (!currentPeriod) return res.json({ myAcademicProgress: null });

  const assessment = await riskAssessmentModel.getForStudentAndPeriod(student.id, currentPeriod.id);
  if (!assessment) return res.json({ myAcademicProgress: null });

  const progress = buildStudentAcademicProgress({
    riskScore: assessment.risk_score,
    averageGrade: assessment.average_grade != null ? Number(assessment.average_grade) : null,
    gradeTrend: assessment.grade_trend != null ? Number(assessment.grade_trend) : null,
    attendanceRate: assessment.attendance_rate != null ? Number(assessment.attendance_rate) : null,
    attendanceTrend: assessment.attendance_trend != null ? Number(assessment.attendance_trend) : null,
  });

  res.json({
    myAcademicProgress: {
      band: progress.band,
      bandLabel: progress.bandLabel,
      // Only meaningful (and only sent) for At Risk — Average/Performing
      // Well were never "Low risk" in the sense a student should read into
      // the word "risk" at all.
      riskLevel: progress.band === 'at_risk' ? assessment.risk_level : null,
      messages: progress.messages,
      note: progress.note,
      averageGrade: progress.averageGrade,
      gradeTrend: progress.gradeTrend,
      attendanceRate: progress.attendanceRate,
      attendanceTrend: progress.attendanceTrend,
      // The concrete numbers that would clear each flag. Safe to send a
      // student: these are the published DepEd-style thresholds the formula
      // checks, not the internal risk score or weights.
      exitTargets: progress.exitTargets,
      // Every check the formula makes and where this student stands against
      // it, plus the band boundaries expressed as a count of flagged checks
      // — what the home page's figures expand into when a student asks why
      // a number is what it is. Same rule as exitTargets above: published
      // thresholds yes, internal score and weights no.
      checks: progress.checks,
      levelsByTriggeredCount: progress.levelsByTriggeredCount,
    },
  });
}

// Every grading period this student has a stored assessment for — the "My
// Progress" trend sparkline's data source. Independent of whether the
// CURRENT period has been finalized yet (getMyAcademicProgress above can
// return null while this still has earlier periods worth showing).
async function getMyProgressTrend(req, res) {
  const student = await getOwnStudentRecord(req);
  if (!student) return res.status(404).json({ error: 'No student record is linked to this account.' });

  const rows = await riskAssessmentModel.listForStudent(student.id);
  res.json({
    // The two thresholds the trend charts draw their reference lines at.
    // Sent with the data rather than mirrored in the frontend so a chart's
    // line and the risk formula's cutoff are the same number by
    // construction — when the client finally confirms the real DepEd
    // attendance figure, config/riskConfig.js is still the only place it
    // changes (CLAUDE.md: thresholds live in one config file).
    passingGrade: GRADE_AT_RISK_THRESHOLD,
    attendanceThreshold: ATTENDANCE_RISK_THRESHOLD,
    periods: rows.map((r) => {
      const averageGrade = r.average_grade != null ? Number(r.average_grade) : null;
      const gradeTrend = r.grade_trend != null ? Number(r.grade_trend) : null;
      // The band for THAT period, re-derived with the same determineBand
      // every other view uses — this is what the Status tab's history strip
      // plots, so "I was Average in Q1 and At Risk in Q2" always agrees
      // with what each period's row actually said at the time.
      const band = determineBand({ riskScore: r.risk_score, averageGrade, gradeTrend });
      return {
        periodName: r.period_name,
        sequenceNumber: r.sequence_number,
        averageGrade,
        attendanceRate: r.attendance_rate != null ? Number(r.attendance_rate) : null,
        band,
        bandLabel: BAND_LABELS[band],
        // Same rule as getMyAcademicProgress: "risk level" is only a
        // meaningful word for the At Risk band.
        riskLevel: band === 'at_risk' ? r.risk_level : null,
      };
    }),
  });
}

// Per-subject finalized grades for the most recent period that has any,
// worst first — "which subjects are pulling me down". Finalized only, the
// same official-record rule the risk formula itself uses (CLAUDE.md: the
// risk formula reads Finalized grades, not Submitted or Principal-Verified),
// so this page can't show a student a grade their adviser hasn't entered
// into the official record yet.
async function getMySubjectGrades(req, res) {
  const student = await getOwnStudentRecord(req);
  if (!student) return res.status(404).json({ error: 'No student record is linked to this account.' });

  const rows = await gradeModel.getFinalizedHistoryForStudent(student.id);
  // The passing mark travels with the data so the page can flag subjects
  // below it without hardcoding 75 in the frontend — config/riskConfig.js
  // stays the only place that number is written down.
  if (rows.length === 0) return res.json({ periodName: null, subjects: [], passingGrade: GRADE_AT_RISK_THRESHOLD });

  // Rows come back ordered by sequence_number, so the last one names the
  // latest period with finalized grades.
  const latestSequence = rows[rows.length - 1].sequence_number;
  const latest = rows.filter((r) => r.sequence_number === latestSequence);

  res.json({
    periodName: latest[0].grading_period_name,
    passingGrade: GRADE_AT_RISK_THRESHOLD,
    subjects: latest
      .map((r) => ({ subjectName: r.subject_name, grade: Number(r.grade_value) }))
      .sort((a, b) => a.grade - b.grade),
  });
}

// The student's own class list: every subject their section is taking this
// school year, who teaches it, and their latest FINALIZED mark in it.
//
// Why this exists: the rest of this page tells a student they are failing
// General Mathematics without ever naming the person who teaches it, so
// "talk to your teacher about this" had no answer attached. The offerings
// come from the section's own class list (classOfferingModel.listBySection
// already filters to the current year and active offerings), so a student
// sees exactly the subjects their section is enrolled in — never the
// school's full catalogue.
async function getMySubjects(req, res) {
  const student = await getOwnStudentRecord(req);
  if (!student) return res.status(404).json({ error: 'No student record is linked to this account.' });

  if (!student.current_section_id) {
    return res.json({ sectionName: null, passingGrade: GRADE_AT_RISK_THRESHOLD, subjects: [] });
  }

  const [offerings, finalized] = await Promise.all([
    classOfferingModel.listBySection(student.current_section_id),
    gradeModel.getFinalizedHistoryForStudent(student.id),
  ]);

  // Latest finalized mark per subject. The history comes back ordered by
  // sequence_number, so the last row seen for a subject is its most recent
  // period — no sorting needed here. Matched on subject NAME because that
  // is what both queries return, and subject names are unique in the
  // subjects table.
  const latestBySubject = new Map();
  for (const row of finalized) {
    latestBySubject.set(row.subject_name, {
      grade: Number(row.grade_value),
      gradingPeriodName: row.grading_period_name,
    });
  }

  res.json({
    sectionName: student.section_name,
    // Travels with the data for the same reason as everywhere else here:
    // the frontend never writes 75 down (config/riskConfig.js owns it).
    passingGrade: GRADE_AT_RISK_THRESHOLD,
    subjects: offerings.map((o) => ({
      subjectName: o.subject_name,
      teacherName: o.teacher_name,
      latestGrade: latestBySubject.get(o.subject_name)?.grade ?? null,
      latestGradePeriod: latestBySubject.get(o.subject_name)?.gradingPeriodName ?? null,
    })),
  });
}

// Attendance per SUBJECT — the supplementary record each subject teacher
// keeps, which this portal has collected all along but never showed the
// student. Deliberately separate from the daily/SF2 figure above, and
// labelled as such in the UI: only the daily record feeds the risk formula
// (CLAUDE.md), and the two numbers will legitimately differ.
async function getMySubjectAttendance(req, res) {
  const student = await getOwnStudentRecord(req);
  if (!student) return res.status(404).json({ error: 'No student record is linked to this account.' });

  const rows = await subjectAttendanceModel.getSubjectSummaryForStudent(student.id);
  res.json({
    // The attendance page colours a subject's rate against the same number
    // the risk formula checks, so it reads it from the server rather than
    // restating it (config/riskConfig.js stays the only place it lives).
    attendanceThreshold: ATTENDANCE_RISK_THRESHOLD,
    subjects: rows.map((r) => ({
      subjectName: r.subject_name,
      teacherName: r.teacher_name,
      present: r.present,
      absent: r.absent,
      late: r.late,
      excused: r.excused,
      totalSessions: r.total_sessions,
      // Same "present includes late" rule the daily attendance rate uses
      // (see dailyAttendanceModel.getAttendanceRatesByPeriod) — the student
      // did attend — so the two figures can be read side by side.
      attendanceRate: r.total_sessions === 0 ? null : Math.round(((r.present + r.late) / r.total_sessions) * 1000) / 10,
    })),
  });
}

// Day counts per grading period, not just the rate — see
// dailyAttendanceModel.getStatusCountsByPeriod for why.
async function getMyAttendanceDetail(req, res) {
  const student = await getOwnStudentRecord(req);
  if (!student) return res.status(404).json({ error: 'No student record is linked to this account.' });

  const rows = await dailyAttendanceModel.getStatusCountsByPeriod(student.id);
  res.json({
    periods: rows.map((r) => ({
      periodName: r.period_name,
      sequenceNumber: r.sequence_number,
      present: r.present,
      absent: r.absent,
      late: r.late,
      excused: r.excused,
      totalDays: r.total_days,
    })),
  });
}

// Read-only: type, status, dates, and the notes describing what was
// actually recommended — never who logged it (that stays staff-internal).
// No status-change route exists on this router at all; logging/editing
// stays admin/adviser/guidance_counselor-only via the existing
// interventionController.js.
async function getMyInterventions(req, res) {
  const student = await getOwnStudentRecord(req);
  if (!student) return res.status(404).json({ error: 'No student record is linked to this account.' });

  const interventions = await interventionModel.listForStudent(student.id);
  res.json({
    interventions: interventions.map((i) => ({
      interventionType: i.intervention_type,
      status: i.status,
      dateLogged: i.date_logged,
      resolvedAt: i.resolved_at,
      notes: i.notes,
    })),
  });
}

module.exports = {
  getMyAcademicProgress,
  getMyProgressTrend,
  getMySubjects,
  getMySubjectAttendance,
  getMySubjectGrades,
  getMyAttendanceDetail,
  getMyInterventions,
};
