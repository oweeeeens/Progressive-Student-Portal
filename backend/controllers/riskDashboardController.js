// The adviser/guidance-counselor dashboard: each student's risk level and
// which specific factors triggered it. risk_assessments only stores the
// numbers (see riskAssessmentModel.js) — the human-readable "why" is
// re-derived here via riskCalculator.evaluateFactors, the exact same
// function the engine used to compute the score in the first place, so the
// dashboard can never disagree with how the score was actually calculated.
const riskAssessmentModel = require('../models/riskAssessmentModel');
const sectionModel = require('../models/sectionModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const { evaluateFactors } = require('../services/riskCalculator');

async function getDashboard(req, res) {
  const { sectionId } = req.query;
  let { gradingPeriodId } = req.query;

  // Default to "today"'s grading period so advisers don't have to know period
  // IDs — same convenience pattern as attendance/grade entry.
  if (!gradingPeriodId) {
    const currentPeriod = await gradingPeriodModel.findByDate(new Date().toISOString().slice(0, 10));
    if (!currentPeriod) {
      return res.status(400).json({ error: 'No grading period is configured for today. Pass gradingPeriodId explicitly.' });
    }
    gradingPeriodId = currentPeriod.id;
  }

  if (sectionId) {
    const section = await sectionModel.getSectionById(Number(sectionId));
    if (!section) return res.status(404).json({ error: 'Section not found.' });

    const { role, id: userId } = req.user;
    const allowed = ['admin', 'guidance_counselor'].includes(role) || (role === 'adviser' && section.adviser_id === userId);
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to view this section.' });
    }
  } else if (req.user.role === 'adviser') {
    // An adviser with no sectionId filter would otherwise see the whole
    // school via listForDashboard's unrestricted path — that's reserved for
    // admin/guidance_counselor. Force advisers to specify their own section.
    return res.status(400).json({ error: 'sectionId is required for the adviser role.' });
  }

  const rows = await riskAssessmentModel.listForDashboard({
    sectionId: sectionId ? Number(sectionId) : undefined,
    gradingPeriodId: Number(gradingPeriodId),
  });

  const students = rows.map((row) => {
    const hasAssessment = row.risk_level != null;
    const factors = hasAssessment
      ? evaluateFactors({
          currentGrade: row.average_grade != null ? Number(row.average_grade) : null,
          gradeTrend: row.grade_trend != null ? Number(row.grade_trend) : null,
          currentAttendanceRate: row.attendance_rate != null ? Number(row.attendance_rate) : null,
          attendanceTrend: row.attendance_trend != null ? Number(row.attendance_trend) : null,
        })
      : [];

    return {
      studentId: row.student_id,
      firstName: row.first_name,
      lastName: row.last_name,
      sectionName: row.section_name,
      gradeLevel: row.grade_level,
      riskLevel: hasAssessment ? row.risk_level : 'not_yet_calculated',
      riskScore: hasAssessment ? row.risk_score : null,
      averageGrade: row.average_grade,
      gradeTrend: row.grade_trend,
      attendanceRate: row.attendance_rate,
      attendanceTrend: row.attendance_trend,
      calculatedAt: row.calculated_at,
      factors,
    };
  });

  res.json({ gradingPeriodId: Number(gradingPeriodId), students });
}

module.exports = { getDashboard };
