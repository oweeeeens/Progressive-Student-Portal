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

// Whether a grading period has begun by `today` (the school's local date,
// YYYY-MM-DD; DATE columns come back as the same kind of string). A term
// that has not started yet has no grades by definition, so its empty cells
// are "not started", never counted as "not submitted" or "not finalized" —
// the reports must not invent a backlog the school does not have.
function periodStarted(period, today) {
  if (!today || !period.start_date) return true;
  return String(period.start_date).slice(0, 10) <= today;
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

// Why a learner on a gradesheet is not simply "in this section, enrolled".
// Said in words on the row, so nobody has to guess what a blank term means.
const STATUS_NOTES = { dropped: 'Dropped', transferred: 'Transferred out', graduated: 'Graduated', pending: 'Enrollment pending' };
function gradesheetNote(student, sectionId) {
  if (student.current_section_id !== sectionId) {
    return student.current_section_name ? `Moved to ${student.current_section_name}` : 'No longer in a section';
  }
  if (student.enrollment_status && student.enrollment_status !== 'enrolled') {
    return STATUS_NOTES[student.enrollment_status] || student.enrollment_status;
  }
  if (student.moved_from) return `Moved here from ${student.moved_from}`;
  return null;
}

// ADVISER GRADESHEET — every learner of the section × every subject the
// section takes in that grading period, FINALIZED grades only, one table per
// period. A subject not taught in a period (a Grade 12 subject runs one
// term) is simply not a column in that period's table.
//
// A cell is one of three things, and they are kept apart:
//   a number        the finalized grade (the official record);
//   null            the learner is in that class, the grade is not finalized yet;
//   notEnrolled     the learner was never in that class (they joined the
//                   section later, or left before it was added) — shown as
//                   "n/e", and not counted against their "N of M finalized".
// Learners who have moved on are kept, labelled ("Moved to STEM B"), because
// their finalized grades from this section are official and would otherwise
// appear on no gradesheet.
function buildGradesheet({ header, periods, offerings, students, grades, enrollments = null, today = null }) {
  const gradeOf = new Map(grades.map((g) => [`${g.student_id}|${g.class_offering_id}|${g.grading_period_id}`, Number(g.grade_value)]));
  // Without enrollment data (older callers) every learner counts as enrolled
  // in every class, which is the old behaviour.
  const enrolledIn = enrollments ? new Set(enrollments.map((e) => `${e.student_id}|${e.class_offering_id}`)) : null;
  const isEnrolled = (studentId, offeringId) => !enrolledIn || enrolledIn.has(`${studentId}|${offeringId}`);

  const periodTables = periods.map((period) => {
    const subjects = offerings.filter((o) =>
      offeringCoversPeriod({ term: o.term, subjectCategory: o.subject_category, periodSequenceNumber: period.sequence_number })
    );
    const started = periodStarted(period, today);
    const rows = students.map((s) => {
      const notEnrolled = subjects.map((o) => !isEnrolled(s.id, o.id));
      const values = subjects.map((o, i) => (notEnrolled[i] ? null : gradeOf.get(`${s.id}|${o.id}|${period.id}`) ?? null));
      const finalized = values.filter((v) => v !== null);
      // A learner who has LEFT (moved on, dropped, transferred) will never
      // get the rest of their grades here, so only the grades finalized
      // before they left count — otherwise the section's "N of M finalized"
      // could never reach M.
      const hasLeft = s.current_section_id !== undefined && (s.current_section_id !== header.id || (s.enrollment_status && s.enrollment_status !== 'enrolled'));
      // Nothing is expected yet of a term that has not started.
      const expectedCount = !started || hasLeft ? finalized.length : notEnrolled.filter((x) => !x).length;
      return {
        studentId: s.id,
        lrn: s.lrn,
        name: fullName(s),
        note: gradesheetNote(s, header.id),
        grades: values,
        notEnrolled,
        finalizedCount: finalized.length,
        // How many grades are expected of the learner in this period: the
        // subjects they are in, or — once they have left — the ones they finished.
        expectedCount,
        hasLeft,
        // The average of the grades finalized so far. It is labelled as
        // such everywhere, because a learner with two of seven subjects
        // finalized does not have a general average yet.
        average: average(finalized),
        complete: expectedCount > 0 && finalized.length === expectedCount,
      };
    });
    const cellCount = rows.reduce((sum, r) => sum + r.expectedCount, 0);
    const finalizedCells = rows.reduce((sum, r) => sum + r.finalizedCount, 0);
    return {
      periodId: period.id,
      periodName: period.name,
      sequenceNumber: period.sequence_number,
      started,
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
    // Of those, the ones in the section and enrolled now.
    currentCount: students.filter((s) => s.current_section_id === undefined || (s.current_section_id === header.id && (!s.enrollment_status || s.enrollment_status === 'enrolled'))).length,
    periods: periodTables,
    generatedAt: new Date(),
  };
}

// SUBJECT TEACHER'S CLASS GRADE REPORT — the learners enrolled in one class
// × the grading periods the class runs in, with each grade and where it is
// in the approval chain (submitted → verified → finalized, or rejected).
function buildClassGrades({ header, periods, students, grades, today = null }) {
  const covered = periods.filter((p) =>
    offeringCoversPeriod({ term: header.term, subjectCategory: header.subject_category, periodSequenceNumber: p.sequence_number })
  );
  const gradeOf = new Map(grades.map((g) => [`${g.student_id}|${g.grading_period_id}`, g]));
  // none = a term that has started with no grade submitted yet;
  // notStarted = an empty cell in a term that has not begun.
  const statusCounts = { submitted: 0, principal_verified: 0, finalized: 0, rejected: 0, none: 0, notStarted: 0 };

  const rows = students.map((s) => {
    const cells = covered.map((p) => {
      const g = gradeOf.get(`${s.id}|${p.id}`);
      if (!g) {
        if (periodStarted(p, today)) statusCounts.none += 1;
        else statusCounts.notStarted += 1;
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
    periods: covered.map((p) => ({ periodId: p.id, periodName: p.name, sequenceNumber: p.sequence_number, started: periodStarted(p, today) })),
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
