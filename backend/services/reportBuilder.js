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

// ENROLLED STUDENT LIST — the current school year's learners placed in a
// section, as filtered, with the total and a count per section. Every
// section in the filtered view is listed, so one with no learner shows 0
// rather than disappearing.
function buildEnrolledList({ students, sections, filters }) {
  const inView = sections.filter(
    (sec) =>
      (!filters.gradeLevel || sec.grade_level === filters.gradeLevel) &&
      (!filters.sectionId || sec.id === filters.sectionId) &&
      (!filters.strand || sec.strand === filters.strand)
  );
  const countBySection = new Map();
  for (const s of students) countBySection.set(s.section_id, (countBySection.get(s.section_id) || 0) + 1);
  const bySex = { M: 0, F: 0, unrecorded: 0 };
  for (const s of students) bySex[s.sex === 'M' || s.sex === 'F' ? s.sex : 'unrecorded'] += 1;

  return {
    schoolYear: sections[0]?.school_year || students[0]?.school_year || null,
    filters,
    total: students.length,
    bySex,
    bySection: inView.map((sec) => ({
      sectionId: sec.id,
      sectionName: sec.name,
      gradeLevel: sec.grade_level,
      strand: sec.strand,
      count: countBySection.get(sec.id) || 0,
    })),
    students: students.map((s) => ({
      id: s.id,
      lrn: s.lrn,
      name: fullName(s),
      sex: s.sex,
      gradeLevel: s.grade_level,
      sectionId: s.section_id,
      sectionName: s.section_name,
      strand: s.strand,
      adviserName: s.adviser_name,
      enrollmentStatus: s.enrollment_status,
      subjectCount: s.subject_count,
    })),
    // What the page's filter pickers offer.
    options: {
      gradeLevels: [...new Set(sections.map((s) => s.grade_level))].sort(),
      strands: [...new Set(sections.map((s) => s.strand).filter(Boolean))].sort(),
      sections: sections.map((s) => ({ id: s.id, name: s.name, gradeLevel: s.grade_level, strand: s.strand })),
    },
    generatedAt: new Date(),
  };
}

// ADMIN MONITORING — the school at a glance for one grading period:
// enrollment per section, grade submission/approval status per class (only
// classes that run in that period), and at-risk learners per section.
function buildMonitoring({ period, sections, classes, atRisk }) {
  const riskBySection = new Map(atRisk.map((r) => [r.section_id, r]));
  const sectionRows = sections.map((s) => {
    const r = riskBySection.get(s.id) || { assessed: 0, high: 0, medium: 0, low: 0 };
    return {
      sectionId: s.id,
      sectionName: s.name,
      gradeLevel: s.grade_level,
      strand: s.strand,
      adviserName: s.adviser_name,
      learners: s.learners,
      classes: s.classes,
      enrollments: s.enrollments,
      atRisk: { high: r.high, medium: r.medium, low: r.low, total: r.high + r.medium + r.low },
      assessed: r.assessed,
    };
  });

  const classRows = classes
    .filter((c) => offeringCoversPeriod({ term: c.term, subjectCategory: c.subject_category, periodSequenceNumber: period.sequence_number }))
    .map((c) => {
      const graded = c.submitted + c.principal_verified + c.finalized + c.rejected;
      return {
        offeringId: c.id,
        subjectName: c.subject_name,
        subjectCode: c.subject_code,
        sectionName: c.section_name,
        gradeLevel: c.grade_level,
        teacherName: c.teacher_name,
        enrolled: c.enrolled,
        submitted: c.submitted,
        verified: c.principal_verified,
        finalized: c.finalized,
        rejected: c.rejected,
        // Enrolled learners with no grade at all yet for this period.
        missing: Math.max(0, c.enrolled - graded),
      };
    });

  const sum = (rows, pick) => rows.reduce((a, r) => a + pick(r), 0);
  return {
    period: { id: period.id, name: period.name, schoolYear: period.school_year },
    sections: sectionRows,
    classes: classRows,
    totals: {
      learners: sum(sectionRows, (r) => r.learners),
      enrollments: sum(sectionRows, (r) => r.enrollments),
      classes: classRows.length,
      submitted: sum(classRows, (r) => r.submitted),
      verified: sum(classRows, (r) => r.verified),
      finalized: sum(classRows, (r) => r.finalized),
      rejected: sum(classRows, (r) => r.rejected),
      missing: sum(classRows, (r) => r.missing),
      atRisk: {
        high: sum(sectionRows, (r) => r.atRisk.high),
        medium: sum(sectionRows, (r) => r.atRisk.medium),
        low: sum(sectionRows, (r) => r.atRisk.low),
        total: sum(sectionRows, (r) => r.atRisk.total),
      },
      assessed: sum(sectionRows, (r) => r.assessed),
    },
    generatedAt: new Date(),
  };
}

module.exports = { buildGradesheet, buildClassGrades, buildEnrolledList, buildMonitoring, average };
