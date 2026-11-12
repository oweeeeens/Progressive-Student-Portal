// Owns reads/writes against the Class Record: assessment_items (one quiz,
// task or exam, with its highest possible score) and assessment_scores (one
// learner's raw score on one item). No grading arithmetic lives here — that
// is services/gradeCalculator.js; this file only stores and fetches.
const { pool } = require('../config/db');

const ITEM_COLUMNS = `id, class_offering_id, grading_period_id, component, exam_part, title,
  highest_possible_score, sequence, created_by, import_id, created_at`;

// The offering together with what the Class Record needs to know about it:
// who teaches it, which section (so the adviser can be recognised) and the
// subject's DepEd weight group.
async function getOfferingContext(classOfferingId) {
  const result = await pool.query(
    `SELECT co.id, co.teacher_id, co.section_id, co.school_year_id, co.term,
            subj.id AS subject_id, subj.name AS subject_name, subj.code AS subject_code,
            subj.weight_group, subj.category AS subject_category,
            sec.name AS section_name, sec.grade_level, sec.adviser_id
     FROM class_offerings co
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     WHERE co.id = $1`,
    [classOfferingId]
  );
  return result.rows[0] || null;
}

// Items for one class and term, in the order the teacher arranged them:
// by component (WW, PT, EX), then exam part, then sequence.
async function listItems(classOfferingId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM assessment_items
     WHERE class_offering_id = $1 AND grading_period_id = $2
     ORDER BY CASE component WHEN 'ww' THEN 1 WHEN 'pt' THEN 2 ELSE 3 END,
              CASE exam_part WHEN 'st1' THEN 1 WHEN 'st2' THEN 2 WHEN 'te' THEN 3 ELSE 0 END,
              sequence, id`,
    [classOfferingId, gradingPeriodId]
  );
  return result.rows;
}

async function getItem(id) {
  const result = await pool.query(`SELECT ${ITEM_COLUMNS} FROM assessment_items WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

// New items go to the end of their component, so "Add quiz" appends rather
// than jumping to the front.
async function createItem({ classOfferingId, gradingPeriodId, component, examPart, title, highestPossibleScore, createdBy, importId = null }, client = pool) {
  const result = await client.query(
    `INSERT INTO assessment_items
       (class_offering_id, grading_period_id, component, exam_part, title, highest_possible_score, sequence, created_by, import_id)
     VALUES ($1, $2, $3::varchar, $4, $5, $6,
       (SELECT COALESCE(MAX(sequence), 0) + 1 FROM assessment_items
        WHERE class_offering_id = $1 AND grading_period_id = $2 AND component = $3::varchar),
       $7, $8)
     RETURNING ${ITEM_COLUMNS}`,
    [classOfferingId, gradingPeriodId, component, examPart, title, highestPossibleScore, createdBy, importId]
  );
  return result.rows[0];
}

async function updateItem(id, { title, highestPossibleScore }) {
  const result = await pool.query(
    `UPDATE assessment_items SET title = $2, highest_possible_score = $3, updated_at = now()
     WHERE id = $1 RETURNING ${ITEM_COLUMNS}`,
    [id, title, highestPossibleScore]
  );
  return result.rows[0] || null;
}

async function deleteItem(id) {
  await pool.query('DELETE FROM assessment_items WHERE id = $1', [id]);
}

// The highest score anyone already has on an item — lowering the item's
// highest possible score below it would make that score impossible.
async function maxScoreOnItem(itemId) {
  const result = await pool.query('SELECT MAX(raw_score) AS max FROM assessment_scores WHERE assessment_item_id = $1', [itemId]);
  return result.rows[0].max === null ? null : Number(result.rows[0].max);
}

// Whether any learner on an item already has a finalized grade for this
// class and term — then the item is part of an official computation and
// must not be deleted or changed.
async function itemTouchesFinalizedGrade(itemId) {
  const result = await pool.query(
    `SELECT 1 FROM assessment_items ai
     JOIN grades g ON g.class_offering_id = ai.class_offering_id
                  AND g.grading_period_id = ai.grading_period_id
                  AND g.status = 'finalized'
     WHERE ai.id = $1 LIMIT 1`,
    [itemId]
  );
  return result.rowCount > 0;
}

// Every score in one class and term.
async function listScores(classOfferingId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT s.assessment_item_id, s.student_id, s.raw_score
     FROM assessment_scores s
     JOIN assessment_items ai ON ai.id = s.assessment_item_id
     WHERE ai.class_offering_id = $1 AND ai.grading_period_id = $2`,
    [classOfferingId, gradingPeriodId]
  );
  return result.rows;
}

// Saves a batch of scores in one transaction. `rawScore: null` clears a
// score (back to "not yet scored"), which is different from saving a 0.
async function saveScores(entries, recordedBy, client = null) {
  const db = client || (await pool.connect());
  const ownsClient = !client;
  try {
    if (ownsClient) await db.query('BEGIN');
    for (const { itemId, studentId, rawScore } of entries) {
      if (rawScore === null) {
        await db.query('DELETE FROM assessment_scores WHERE assessment_item_id = $1 AND student_id = $2', [itemId, studentId]);
      } else {
        await db.query(
          `INSERT INTO assessment_scores (assessment_item_id, student_id, raw_score, recorded_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (assessment_item_id, student_id)
           DO UPDATE SET raw_score = EXCLUDED.raw_score, recorded_by = EXCLUDED.recorded_by, recorded_at = now()`,
          [itemId, studentId, rawScore, recordedBy]
        );
      }
    }
    if (ownsClient) await db.query('COMMIT');
  } catch (err) {
    if (ownsClient) await db.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) db.release();
  }
}

// The grade row (if any) each learner already has for this class and term
// — status, value, the principal's note, and the snapshot it was computed
// from. The Class Record shows these beside the live computation.
async function listGradesForOffering(classOfferingId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT id, student_id, grade_value, status, rejection_note, computation
     FROM grades WHERE class_offering_id = $1 AND grading_period_id = $2`,
    [classOfferingId, gradingPeriodId]
  );
  return result.rows;
}

// --- One learner across all their classes (the learner's own record) -------

// Every active class offering of the learner's current section in a school
// year, with what the computation needs (weight group, term, category).
async function listOfferingsForStudent(studentId, schoolYearId) {
  const result = await pool.query(
    `SELECT co.id, co.term, subj.id AS subject_id, subj.name AS subject_name, subj.code AS subject_code,
            subj.weight_group, subj.category AS subject_category, u.full_name AS teacher_name
     FROM students s
     JOIN class_offerings co ON co.section_id = s.current_section_id AND co.is_active = TRUE
     JOIN subjects subj ON subj.id = co.subject_id
     LEFT JOIN users u ON u.id = co.teacher_id
     WHERE s.id = $1 AND co.school_year_id = $2
     ORDER BY subj.name`,
    [studentId, schoolYearId]
  );
  return result.rows;
}

// All items of the given offerings, every term, in display order.
async function listItemsForOfferings(offeringIds) {
  if (offeringIds.length === 0) return [];
  const result = await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM assessment_items
     WHERE class_offering_id = ANY($1::int[])
     ORDER BY CASE component WHEN 'ww' THEN 1 WHEN 'pt' THEN 2 ELSE 3 END,
              CASE exam_part WHEN 'st1' THEN 1 WHEN 'st2' THEN 2 WHEN 'te' THEN 3 ELSE 0 END,
              sequence, id`,
    [offeringIds]
  );
  return result.rows;
}

// This learner's scores on any item of the given offerings.
async function listScoresForStudent(studentId, offeringIds) {
  if (offeringIds.length === 0) return [];
  const result = await pool.query(
    `SELECT s.assessment_item_id, s.raw_score
     FROM assessment_scores s
     JOIN assessment_items ai ON ai.id = s.assessment_item_id
     WHERE s.student_id = $1 AND ai.class_offering_id = ANY($2::int[])`,
    [studentId, offeringIds]
  );
  return result.rows;
}

// This learner's grade rows (any status) for the given offerings.
async function listGradesForStudent(studentId, offeringIds) {
  if (offeringIds.length === 0) return [];
  const result = await pool.query(
    `SELECT id, class_offering_id, grading_period_id, grade_value, status, computation
     FROM grades WHERE student_id = $1 AND class_offering_id = ANY($2::int[])`,
    [studentId, offeringIds]
  );
  return result.rows;
}

module.exports = {
  listOfferingsForStudent,
  listItemsForOfferings,
  listScoresForStudent,
  listGradesForStudent,
  getOfferingContext,
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  maxScoreOnItem,
  itemTouchesFinalizedGrade,
  listScores,
  saveScores,
  listGradesForOffering,
};
