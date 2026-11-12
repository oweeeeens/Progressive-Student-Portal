// Assembles one Class Record — a class, a term, its items, every learner's
// scores — and runs the DepEd computation for each learner. The controller
// asks this for "the record as it stands"; this asks the models for the
// rows and services/gradeCalculator.js for the arithmetic, so neither the
// HTTP layer nor the SQL layer ever does grading maths.
const assessmentModel = require('../models/assessmentModel');
const gradeModel = require('../models/gradeModel');
const { computeTermGrade } = require('./gradeCalculator');
const { GRADING_MODE } = require('../config/gradingPolicy');
const { offeringCoversPeriod } = require('../config/academicTerms');

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

// One learner's complete class record for a school year: every subject they
// take, every term it runs in, every item with their score, and the DepEd
// computation — what the adviser wants to see on the learner's record.
//
// For each subject x term:
//   items     the quizzes/tasks/exams with this learner's raw score (or null)
//   computed  the live computation from those scores (complete or not)
//   grade     the grade row in the approval chain, if one exists
//   provisional  true when there are scores but no submitted grade yet —
//                the page labels that figure as not official.
async function buildStudentClassRecord(studentId, schoolYearId, gradingPeriods) {
  const offerings = await assessmentModel.listOfferingsForStudent(studentId, schoolYearId);
  const offeringIds = offerings.map((o) => o.id);
  const [itemRows, scoreRows, gradeRows] = await Promise.all([
    assessmentModel.listItemsForOfferings(offeringIds),
    assessmentModel.listScoresForStudent(studentId, offeringIds),
    assessmentModel.listGradesForStudent(studentId, offeringIds),
  ]);
  const scores = new Map(scoreRows.map((r) => [r.assessment_item_id, Number(r.raw_score)]));

  const subjects = offerings.map((offering) => {
    const terms = {};
    for (const period of gradingPeriods) {
      if (!offeringCoversPeriod({ term: offering.term, subjectCategory: offering.subject_category, periodSequenceNumber: period.sequence_number })) {
        continue;
      }
      const items = itemRows
        .filter((r) => r.class_offering_id === offering.id && r.grading_period_id === period.id)
        .map(toItem);
      const grade = gradeRows.find((g) => g.class_offering_id === offering.id && g.grading_period_id === period.id) || null;
      const computed = items.length > 0 ? computeTermGrade({ items, scores, weightGroup: offering.weight_group, mode: GRADING_MODE }) : null;
      terms[period.id] = {
        items: items.map((item) => ({ ...item, rawScore: scores.has(item.id) ? scores.get(item.id) : null })),
        computed,
        grade: grade && { id: grade.id, value: Number(grade.grade_value), status: grade.status, computation: grade.computation },
        provisional: Boolean(!grade && computed?.complete),
      };
    }
    return {
      classOfferingId: offering.id,
      subjectId: offering.subject_id,
      subjectName: offering.subject_name,
      teacherName: offering.teacher_name,
      weightGroup: offering.weight_group,
      terms,
    };
  });
  return { subjects };
}

module.exports = { buildClassRecord, buildStudentClassRecord, toItem };
