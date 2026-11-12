// Assembles one Class Record — a class, a term, its items, every learner's
// scores — and runs the DepEd computation for each learner. The controller
// asks this for "the record as it stands"; this asks the models for the
// rows and services/gradeCalculator.js for the arithmetic, so neither the
// HTTP layer nor the SQL layer ever does grading maths.
const assessmentModel = require('../models/assessmentModel');
const gradeModel = require('../models/gradeModel');
const { computeTermGrade } = require('./gradeCalculator');
const { GRADING_MODE } = require('../config/gradingPolicy');

// Database row -> the shape the calculator and the page use.
function toItem(row) {
  return {
    id: row.id,
    component: row.component,
    examPart: row.exam_part,
    title: row.title,
    highestPossibleScore: Number(row.highest_possible_score),
    sequence: row.sequence,
    imported: row.import_id !== null,
  };
}

// The full record for one class offering and grading period.
//
// For every learner: their scores (itemId -> raw), the live computation
// from those scores, and the grade row already in the approval chain, if
// any. `changedSinceSubmission` is true when the grade on record no longer
// matches what the scores now compute — a score was corrected after the
// teacher submitted, and the record needs resubmitting to count.
async function buildClassRecord(offering, gradingPeriodId) {
  const [itemRows, scoreRows, roster, gradeRows] = await Promise.all([
    assessmentModel.listItems(offering.id, gradingPeriodId),
    assessmentModel.listScores(offering.id, gradingPeriodId),
    gradeModel.getActiveStudentsInOffering(offering.id),
    assessmentModel.listGradesForOffering(offering.id, gradingPeriodId),
  ]);
  const items = itemRows.map(toItem);

  const scoresByStudent = new Map();
  for (const row of scoreRows) {
    if (!scoresByStudent.has(row.student_id)) scoresByStudent.set(row.student_id, new Map());
    scoresByStudent.get(row.student_id).set(row.assessment_item_id, Number(row.raw_score));
  }
  const gradeByStudent = new Map(gradeRows.map((g) => [g.student_id, g]));

  const learners = roster.map((student) => {
    const scores = scoresByStudent.get(student.id) || new Map();
    const computed = computeTermGrade({ items, scores, weightGroup: offering.weight_group, mode: GRADING_MODE });
    const grade = gradeByStudent.get(student.id) || null;
    return {
      studentId: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      scores: Object.fromEntries(scores),
      computed,
      grade: grade && {
        id: grade.id,
        value: Number(grade.grade_value),
        status: grade.status,
        rejectionNote: grade.rejection_note,
      },
      changedSinceSubmission: Boolean(grade && computed.complete && Number(grade.grade_value) !== computed.termGrade),
    };
  });

  return { items, learners };
}

module.exports = { buildClassRecord, toItem };
