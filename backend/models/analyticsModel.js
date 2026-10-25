// Raw aggregate queries backing the Analytics module. Every query here
// reads from tables that already exist for other modules (students,
// risk_assessments, interventions, daily_attendance_records,
// grading_periods) — per the brief, no new data collection, this module is
// read-only aggregation on top of what's already recorded. Classification
// (which band a risk_assessments row falls into, which factors it
// triggered) is deliberately NOT done in SQL — see
// services/analyticsCalculator.js, which reuses the exact same
// riskCalculator.evaluateFactors / academicProgressCalculator.determineBand
// functions the per-student views use, so the school-wide numbers can never
// disagree with what an adviser sees on one student's row.
//
// For the same reason, NO query here pre-aggregates away the rows the
// Analytics page's filters need. Every query returns one row per student
// (or per intervention), each carrying the four filterable dimensions —
// section_id, grade_level, strand, and that row's own risk fields — so the
// single pure filterRows() in analyticsCalculator.js can scope all of them
// identically. Grouping into per-section or per-period rates happens in the
// calculator, AFTER filtering; doing it in SQL would make a risk-band
// filter impossible (the band is derived, not stored) and would mean a
// different filter implementation per endpoint.
const { pool } = require('../config/db');

// Every active student's latest assessment for one grading period, plus
// enough section/grade-level context to break the distribution down by
// either dimension. LEFT JOIN so a student with no assessment yet (not yet
// calculated) still appears — the calculator service decides what band that
// is, not this query.
async function getAssessmentsForPeriod(gradingPeriodId) {
  const result = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name, s.current_section_id,
            sec.name AS section_name, sec.grade_level, sec.strand,
            ra.average_grade, ra.grade_trend, ra.attendance_rate, ra.attendance_trend,
            ra.risk_score, ra.risk_level
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.current_section_id
     LEFT JOIN risk_assessments ra ON ra.student_id = s.id AND ra.grading_period_id = $1
     WHERE s.is_active = TRUE`,
    [gradingPeriodId]
  );
  return result.rows;
}

// Every assessment across every grading period in one school year (default:
// the current one) — the source data for the trend-over-time chart. One
// query, grouped in JS by grading_period_id, rather than one query per
// period.
async function getAssessmentsForSchoolYear(schoolYearId) {
  const clause = schoolYearId ? 'sy.id = $1' : 'sy.is_current = TRUE';
  const params = schoolYearId ? [schoolYearId] : [];
  const result = await pool.query(
    `SELECT ra.student_id, gp.id AS grading_period_id, gp.name AS period_name, gp.sequence_number,
            s.current_section_id, sec.name AS section_name, sec.grade_level, sec.strand,
            ra.average_grade, ra.grade_trend, ra.attendance_rate, ra.attendance_trend,
            ra.risk_score, ra.risk_level
     FROM risk_assessments ra
     JOIN students s ON s.id = ra.student_id
     LEFT JOIN sections sec ON sec.id = s.current_section_id
     JOIN grading_periods gp ON gp.id = ra.grading_period_id
     JOIN school_years sy ON sy.id = gp.school_year_id
     WHERE s.is_active = TRUE AND ${clause}
     ORDER BY gp.sequence_number`,
    params
  );
  return result.rows;
}

// One row per student per period: their attendance tally for that period
// plus that same period's risk fields (LEFT JOIN — a student with
// attendance but no finalized assessment yet still appears, with nulls the
// calculator treats as "not yet calculated"). Backs BOTH the Attendance
// tab's school-wide/section trend line AND its At-Risk-vs-everyone-else
// comparison: both are just different groupings of these same rows, so one
// query serves both and the two charts can never disagree. "At risk" has
// to be evaluated per period, not once overall, since a student's band can
// change period to period. "Present" and "late" both count as attended,
// the same definition dailyAttendanceModel.getAttendanceRatesByPeriod
// already uses for a single student.
async function getAttendanceWithRiskByPeriod(schoolYearId) {
  const clause = schoolYearId ? 'sy.id = $1' : 'sy.is_current = TRUE';
  const params = schoolYearId ? [schoolYearId] : [];
  const result = await pool.query(
    `SELECT dar.student_id, gp.id AS grading_period_id, gp.name AS period_name, gp.sequence_number,
            s.current_section_id, sec.name AS section_name, sec.grade_level, sec.strand,
            COUNT(*)::int AS total_days,
            COUNT(*) FILTER (WHERE dar.status IN ('present', 'late'))::int AS attended_days,
            ra.risk_score, ra.risk_level, ra.average_grade, ra.grade_trend
     FROM daily_attendance_records dar
     JOIN students s ON s.id = dar.student_id
     LEFT JOIN sections sec ON sec.id = s.current_section_id
     JOIN grading_periods gp ON gp.id = dar.grading_period_id
     JOIN school_years sy ON sy.id = gp.school_year_id
     LEFT JOIN risk_assessments ra ON ra.student_id = dar.student_id AND ra.grading_period_id = dar.grading_period_id
     WHERE s.is_active = TRUE AND ${clause}
     GROUP BY dar.student_id, gp.id, gp.name, gp.sequence_number,
              s.current_section_id, sec.name, sec.grade_level, sec.strand,
              ra.risk_score, ra.risk_level, ra.average_grade, ra.grade_trend
     ORDER BY gp.sequence_number`,
    params
  );
  return result.rows;
}

// One row per student for a single grading period: their attendance tally
// plus section/grade/strand and that period's risk fields. The calculator
// groups these into per-section rates (sectionAttendanceRates) for the
// Attendance tab's "lowest-attendance sections" table — grouped in JS, not
// SQL, so the same filters that scope every other chart apply here too.
async function getStudentAttendanceForPeriod(gradingPeriodId) {
  const result = await pool.query(
    `SELECT dar.student_id, s.current_section_id,
            sec.name AS section_name, sec.grade_level, sec.strand,
            COUNT(*)::int AS total_days,
            COUNT(*) FILTER (WHERE dar.status IN ('present', 'late'))::int AS attended_days,
            ra.risk_score, ra.risk_level, ra.average_grade, ra.grade_trend
     FROM daily_attendance_records dar
     JOIN students s ON s.id = dar.student_id
     LEFT JOIN sections sec ON sec.id = s.current_section_id
     LEFT JOIN risk_assessments ra ON ra.student_id = dar.student_id AND ra.grading_period_id = dar.grading_period_id
     WHERE dar.grading_period_id = $1 AND s.is_active = TRUE
     GROUP BY dar.student_id, s.current_section_id, sec.name, sec.grade_level, sec.strand,
              ra.risk_score, ra.risk_level, ra.average_grade, ra.grade_trend`,
    [gradingPeriodId]
  );
  return result.rows;
}

// One row per logged intervention — its type and status, the student's
// section/grade/strand, and the risk fields of the assessment it was logged
// against (the same risk_assessment_id join interventionModel.listForStudent
// uses to find "which period was this logged in"; interventions has no
// grading_period_id column of its own). Backs both the effectiveness
// rollup and the volume-over-time chart, and carries the dimensions those
// two need in order to respect the page's filters.
//
// Not scoped to is_active students: a closed intervention's outcome is a
// historical fact about whether the program worked, independent of whether
// that student is still currently enrolled.
async function getInterventionRows() {
  const result = await pool.query(
    `SELECT i.id, i.intervention_type, i.status,
            s.current_section_id, sec.name AS section_name, sec.grade_level, sec.strand,
            gp.id AS grading_period_id, gp.name AS period_name, gp.sequence_number,
            ra.risk_score, ra.risk_level, ra.average_grade, ra.grade_trend
     FROM interventions i
     JOIN students s ON s.id = i.student_id
     LEFT JOIN sections sec ON sec.id = s.current_section_id
     JOIN risk_assessments ra ON ra.id = i.risk_assessment_id
     JOIN grading_periods gp ON gp.id = ra.grading_period_id
     ORDER BY gp.sequence_number`
  );
  return result.rows;
}

module.exports = {
  getAssessmentsForPeriod,
  getAssessmentsForSchoolYear,
  getAttendanceWithRiskByPeriod,
  getStudentAttendanceForPeriod,
  getInterventionRows,
};
