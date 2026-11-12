// Reads behind Analytics' "Learner Outlook" tab. Rows only — the views are
// computed in services/outlookCalculator.js. Every row carries
// current_section_id / grade_level / strand so analyticsCalculator.filterRows
// can apply the page's filters and an adviser's section scope unchanged.
const { pool } = require('../config/db');

const LEARNER_COLUMNS = `s.id AS student_id, s.first_name, s.last_name, s.current_section_id,
  sec.name AS section_name, sec.grade_level, sec.strand`;

// Every FINALIZED grade in a school year — the official record the
// promotion outlook and subjects-causing-failure views are built from.
async function getFinalizedGradesForYear(schoolYearId) {
  const result = await pool.query(
    `SELECT ${LEARNER_COLUMNS}, g.class_offering_id, subj.name AS subject_name,
            g.grading_period_id, gp.sequence_number, g.grade_value
     FROM grades g
     JOIN students s ON s.id = g.student_id AND s.is_active = TRUE
     JOIN sections sec ON sec.id = s.current_section_id
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN grading_periods gp ON gp.id = g.grading_period_id
     WHERE g.status = 'finalized' AND gp.school_year_id = $1`,
    [schoolYearId]
  );
  return result.rows;
}

// Everything needed to compute every learner's class record for one term:
// the classes taught in it, their items, the scores, and the rosters.
async function getClassRecordDataForPeriod(periodId) {
  const offerings = (
    await pool.query(
      `SELECT co.id, co.term, co.section_id, subj.name AS subject_name, subj.weight_group,
              subj.category AS subject_category, sec.name AS section_name, sec.grade_level, sec.strand
       FROM class_offerings co
       JOIN grading_periods gp ON gp.id = $1 AND gp.school_year_id = co.school_year_id
       JOIN subjects subj ON subj.id = co.subject_id
       JOIN sections sec ON sec.id = co.section_id
       WHERE co.is_active = TRUE`,
      [periodId]
    )
  ).rows;
  const offeringIds = offerings.map((o) => o.id);
  if (offeringIds.length === 0) return { offerings: [], items: [], scores: [], students: [], finalized: [] };
  const [items, scores, students, finalized] = await Promise.all([
    pool.query(
      `SELECT id, class_offering_id, component, exam_part, title, highest_possible_score
       FROM assessment_items WHERE grading_period_id = $1 AND class_offering_id = ANY($2::int[])`,
      [periodId, offeringIds]
    ),
    pool.query(
      `SELECT sc.assessment_item_id, sc.student_id, sc.raw_score
       FROM assessment_scores sc JOIN assessment_items ai ON ai.id = sc.assessment_item_id
       WHERE ai.grading_period_id = $1 AND ai.class_offering_id = ANY($2::int[])`,
      [periodId, offeringIds]
    ),
    pool.query(
      `SELECT ${LEARNER_COLUMNS}
       FROM students s JOIN sections sec ON sec.id = s.current_section_id
       WHERE s.is_active = TRUE AND s.current_section_id = ANY($1::int[])`,
      [[...new Set(offerings.map((o) => o.section_id))]]
    ),
    // Grades already FINALIZED this term: official, so they are not part of
    // the provisional early warning (they count in the promotion outlook).
    pool.query(
      `SELECT student_id, class_offering_id FROM grades
       WHERE grading_period_id = $1 AND status = 'finalized' AND class_offering_id = ANY($2::int[])`,
      [periodId, offeringIds]
    ),
  ]);
  return { offerings, items: items.rows, scores: scores.rows, students: students.rows, finalized: finalized.rows };
}

// Absences per learner this school year, from the adviser's daily (SF2)
// register: absent and excused counted separately, and the days recorded.
async function getAbsenceCountsForYear(schoolYearId) {
  const result = await pool.query(
    `SELECT ${LEARNER_COLUMNS},
            COUNT(*) FILTER (WHERE d.status = 'absent')::int AS absent,
            COUNT(*) FILTER (WHERE d.status = 'excused')::int AS excused,
            COUNT(*)::int AS recorded_days
     FROM daily_attendance_records d
     JOIN grading_periods gp ON gp.id = d.grading_period_id AND gp.school_year_id = $1
     JOIN students s ON s.id = d.student_id AND s.is_active = TRUE
     JOIN sections sec ON sec.id = s.current_section_id
     GROUP BY s.id, sec.id`,
    [schoolYearId]
  );
  return result.rows;
}

module.exports = { getFinalizedGradesForYear, getClassRecordDataForPeriod, getAbsenceCountsForYear };
