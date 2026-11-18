// Turns report rows (models/reportModel.js) into the shape the page, the PDF
// and the workbook all draw from — so the three can never disagree. Pure: no
// database, no HTTP. Same split as analyticsCalculator / analyticsReport.
const { offeringCoversPeriod } = require('../config/academicTerms');

const fullName = (s) => `${s.last_name}, ${[s.first_name, s.middle_name].filter(Boolean).join(' ')}`;

// Two decimals, the way the Class Record rounds — null when there is nothing.
function average(values) {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function toSubject(o) {
  return {
    offeringId: o.id,
    subjectName: o.subject_name,
    subjectCode: o.subject_code,
    subjectCategory: o.subject_category,
    term: o.term,
    teacherName: o.teacher_name,
  };
}

// ADVISER GRADESHEET — every learner in the section × every subject the
// section takes in that grading period, FINALIZED grades only, one table per
// period. A subject not taught in a period (a Grade 12 subject runs one
// term) is simply not a column in that period's table, so a blank cell can
// only mean "taught, not finalized yet".
function buildGradesheet({ header, periods, offerings, students, grades }) {
  const gradeOf = new Map(grades.map((g) => [`${g.student_id}|${g.class_offering_id}|${g.grading_period_id}`, Number(g.grade_value)]));

  const periodTables = periods.map((period) => {
    const subjects = offerings.filter((o) =>
      offeringCoversPeriod({ term: o.term, subjectCategory: o.subject_category, periodSequenceNumber: period.sequence_number })
    );
    const rows = students.map((s) => {
      const values = subjects.map((o) => gradeOf.get(`${s.id}|${o.id}|${period.id}`) ?? null);
      const finalized = values.filter((v) => v !== null);
      return {
        studentId: s.id,
        lrn: s.lrn,
        name: fullName(s),
        grades: values,
        finalizedCount: finalized.length,
        // The average of the grades finalized so far. It is labelled as
        // such everywhere, because a learner with two of seven subjects
        // finalized does not have a general average yet.
        average: average(finalized),
        complete: subjects.length > 0 && finalized.length === subjects.length,
      };
    });
    const cellCount = rows.length * subjects.length;
    const finalizedCells = rows.reduce((sum, r) => sum + r.finalizedCount, 0);
    return {
      periodId: period.id,
      periodName: period.name,
      sequenceNumber: period.sequence_number,
      subjects: subjects.map(toSubject),
      rows,
      finalizedCells,
      cellCount,
    };
  });

  return {
    section: {
      id: header.id,
      name: header.name,
      gradeLevel: header.grade_level,
      strand: header.strand,
      schoolYear: header.school_year,
      adviserName: header.adviser_name,
    },
    subjects: offerings.map(toSubject),
    studentCount: students.length,
    periods: periodTables,
    generatedAt: new Date(),
  };
}

// SUBJECT TEACHER'S CLASS GRADE REPORT — the learners enrolled in one class
// × the grading periods the class runs in, with each grade and where it is
// in the approval chain (submitted → verified → finalized, or rejected).
function buildClassGrades({ header, periods, students, grades }) {
  const covered = periods.filter((p) =>
    offeringCoversPeriod({ term: header.term, subjectCategory: header.subject_category, periodSequenceNumber: p.sequence_number })
  );
  const gradeOf = new Map(grades.map((g) => [`${g.student_id}|${g.grading_period_id}`, g]));
  const statusCounts = { submitted: 0, principal_verified: 0, finalized: 0, rejected: 0, none: 0 };

  const rows = students.map((s) => {
    const cells = covered.map((p) => {
      const g = gradeOf.get(`${s.id}|${p.id}`);
      if (!g) {
        statusCounts.none += 1;
        return null;
      }
      statusCounts[g.status] += 1;
      return { value: Number(g.grade_value), status: g.status };
    });
    const finalized = cells.filter((c) => c && c.status === 'finalized').map((c) => c.value);
    return { studentId: s.id, lrn: s.lrn, name: fullName(s), cells, finalizedAverage: average(finalized) };
  });

  return {
    offering: {
      id: header.id,
      subjectName: header.subject_name,
      subjectCode: header.subject_code,
      subjectCategory: header.subject_category,
      term: header.term,
      sectionName: header.section_name,
      gradeLevel: header.grade_level,
      strand: header.strand,
      schoolYear: header.school_year,
      teacherName: header.teacher_name,
    },
    periods: covered.map((p) => ({ periodId: p.id, periodName: p.name, sequenceNumber: p.sequence_number })),
    rows,
    statusCounts,
    studentCount: students.length,
    generatedAt: new Date(),
  };
}

module.exports = { buildGradesheet, buildClassGrades, average };
