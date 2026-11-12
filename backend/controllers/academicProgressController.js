// Academic Progress Tracking (formerly "Risk Dashboard") — every student in
// scope, grouped into three performance bands (At Risk / Average-Steady /
// Performing Well), not just the flagged ones. risk_assessments only stores
// the numbers (see riskAssessmentModel.js) — the human-readable factors,
// band, and advisory/encouragement/recognition text are all re-derived here
// via academicProgressCalculator.buildAcademicProgress, which itself is
// built on riskCalculator.evaluateFactors (the exact same function the
// engine used to compute the score in the first place), so none of this can
// ever disagree with how the score was actually calculated. The underlying
// risk-scoring formula is unchanged — this file is a presentation layer on
// top of it, per CLAUDE.md's Academic Progress Tracking Logic section.
const riskAssessmentModel = require('../models/riskAssessmentModel');
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const sectionModel = require('../models/sectionModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const { buildAcademicProgress } = require('../services/academicProgressCalculator');

// The roles that may read the whole school at once. Named once because it is
// asked twice below, and the two answers must not drift apart.
const SCHOOL_WIDE_ROLES = ['admin', 'principal', 'guidance_counselor'];

async function getAcademicProgress(req, res) {
  const { sectionId } = req.query;
  let { gradingPeriodId } = req.query;

  // Default to "today"'s grading period so advisers don't have to know period
  // IDs — same convenience pattern as attendance/grade entry.
  if (!gradingPeriodId) {
    const currentPeriod = await gradingPeriodModel.findByDate(todayInSchoolTimezone());
    if (!currentPeriod) {
      return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });
    }
    gradingPeriodId = currentPeriod.id;
  }

  if (sectionId) {
    const section = await sectionModel.getSectionById(Number(sectionId));
    if (!section) return res.status(404).json({ error: 'Section not found.' });

    const { role, id: userId } = req.user;
    // A SECOND list, separate from the route's gate: this one runs when a
    // section filter is applied. A role missing here is let through the
    // route and then refused the moment it picks a section, so the two have
    // to be kept in step.
    //
    // `section.adviser_id === userId` carries NO role conjunct. It used to
    // read `role === 'adviser' && section.adviser_id === userId`, which
    // refused someone their own advisory section's progress view purely
    // because their role column said something else.
    const allowed = SCHOOL_WIDE_ROLES.includes(role) || section.adviser_id === userId;
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to view this section.' });
    }
  } else if (!SCHOOL_WIDE_ROLES.includes(req.user.role)) {
    // Without a section filter, listForDashboard below is UNRESTRICTED —
    // every at-risk student in the school. That is reserved for the
    // school-wide roles.
    //
    // This used to test `role === 'adviser'`, which is the wrong question
    // and left a hole: anyone who advises a section while carrying a
    // different role label skipped the guard entirely and fell straight
    // through to the school-wide list. Asking "are you school-wide?"
    // instead fails closed for everyone who is not.
    return res.status(400).json({ error: 'Select a section to view its progress.' });
  }

  const rows = await riskAssessmentModel.listForDashboard({
    sectionIds: sectionId ? [Number(sectionId)] : undefined,
    gradingPeriodId: Number(gradingPeriodId),
  });

  const students = rows.map((row) => {
    const hasAssessment = row.risk_level != null;
    const progress = hasAssessment
      ? buildAcademicProgress({
          riskScore: row.risk_score,
          averageGrade: row.average_grade != null ? Number(row.average_grade) : null,
          gradeTrend: row.grade_trend != null ? Number(row.grade_trend) : null,
          attendanceRate: row.attendance_rate != null ? Number(row.attendance_rate) : null,
          attendanceTrend: row.attendance_trend != null ? Number(row.attendance_trend) : null,
        })
      : null;

    return {
      studentId: row.student_id,
      firstName: row.first_name,
      lastName: row.last_name,
      sectionName: row.section_name,
      gradeLevel: row.grade_level,
      // Whether THIS reader may log an intervention for the learner: only
      // the adviser of their section may (interventionController.js — no
      // third parties). Sent so the page offers the action only where the
      // server will accept it; the server still checks on its own.
      canLogIntervention: row.adviser_id === req.user.id,
      riskLevel: hasAssessment ? row.risk_level : 'not_yet_calculated',
      riskScore: hasAssessment ? row.risk_score : null,
      averageGrade: row.average_grade,
      gradeTrend: row.grade_trend,
      attendanceRate: row.attendance_rate,
      attendanceTrend: row.attendance_trend,
      calculatedAt: row.calculated_at,
      band: hasAssessment ? progress.band : 'not_yet_calculated',
      bandLabel: hasAssessment ? progress.bandLabel : 'Not Yet Calculated',
      factors: hasAssessment ? progress.factors : [],
      advisories: hasAssessment ? progress.advisories : [],
      topConcern: hasAssessment ? progress.topConcern : null,
      note: hasAssessment ? progress.note : null,
    };
  });

  res.json({ gradingPeriodId: Number(gradingPeriodId), students });
}

module.exports = { getAcademicProgress };
