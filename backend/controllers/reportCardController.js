// Generates a printable PDF report card for one student — official
// (finalized) grades only, grouped by subject and grading period, plus the
// daily/SF2 attendance summary. Access is narrower than general Student
// Records visibility: admin, registrar, or the actual adviser of this
// student's current section (by assignment — section.adviser_id, not by
// role label; see gradeController.js for the same convention and why).
const studentModel = require('../models/studentModel');
const gradeModel = require('../models/gradeModel');
const dailyAttendanceModel = require('../models/dailyAttendanceModel');
const sectionModel = require('../models/sectionModel');
const classOfferingModel = require('../models/classOfferingModel');
const schoolYearModel = require('../models/schoolYearModel');
const { buildReportCardPdf } = require('../services/reportCardPdf');
const { offeringCoversPeriod } = require('../config/academicTerms');

// The marker a cell carries when the subject was NOT TAUGHT in that term,
// as opposed to taught with no mark recorded. Not null, because null
// already means the second thing, and the whole point here is that the
// two are different claims.
const NOT_OFFERED = 'not_offered';

const SCHOOL = {
  name: 'DepEd Progressive Senior High School — Bacoor City',
  address: 'Bacoor City, Cavite, Philippines',
};

// Reshapes a flat list of {grade_value, subject_name, grading_period_name,
// sequence_number} rows (one per subject+period) into the subject-rows ×
// period-columns grid the PDF draws, plus a single overall average.
// Periods are exactly the ones that actually have a finalized grade for
// SOME subject — a period nothing's been finalized for yet simply doesn't
// get a column, matching "grading period completed so far".
//
// A BLANK CELL USED TO MEAN TWO DIFFERENT THINGS, on the one document in
// this system that is printed and handed to a parent.
//
// "Not taught in this term" and "taught, but no mark recorded" both came out
// as the same dash. That was already wrong, and the three-term model makes
// it worse rather than better: a Grade 12 subject now runs in one term out
// of three, so such a row shows two blank cells and no way to tell which
// kind of blank they are. The grade VIEW was restructured into one table per
// term precisely to avoid this; paper has no tabs, so the card has to say it
// in the cell.
//
// `sectionOfferings` is what makes the distinction answerable: the classes
// this learner's section actually runs this year. When it is empty — no
// section on the record, or a card for a PAST school year, which
// classOfferingModel.listBySection does not cover — nothing is marked and
// every cell behaves exactly as it did before. Fail open: on a parent-facing
// document, a dash that might mean either is better than an "n/a" that might
// be a lie.
function pivotFinalizedGrades(rows, sectionOfferings = []) {
  const periodsBySeq = new Map();

  // Which terms each subject is offered in, taken from the section's class
  // offerings rather than from the grade rows. A subject CAN be offered to
  // one section more than once in a year (once per term), so this is a list
  // per subject; a subject the section does not offer at all is simply
  // absent, which is what leaves its cells unmarked.
  const offeringsBySubjectId = new Map();
  for (const offering of sectionOfferings) {
    if (!offeringsBySubjectId.has(offering.subject_id)) offeringsBySubjectId.set(offering.subject_id, []);
    offeringsBySubjectId.get(offering.subject_id).push(offering);
  }

  // Was this subject taught to this learner in this period? `null` means
  // "cannot tell", which the caller treats as taught.
  function wasOffered(subjectId, sequenceNumber) {
    const offerings = offeringsBySubjectId.get(subjectId);
    if (!offerings || offerings.length === 0) return null;
    return offerings.some((o) =>
      offeringCoversPeriod({
        term: o.term,
        subjectCategory: o.subject_category,
        periodSequenceNumber: sequenceNumber,
      })
    );
  }

  // Keyed on subject_id, not name. Two subjects can share a name — only
  // `code` is UNIQUE on the subjects table — and a Grade 11 and a Grade 12
  // "Practical Research" are exactly that case. Keyed by name they merged
  // into one row of the printed card, with one subject's marks sitting
  // under both, on a document the school hands to a parent.
  const subjectsById = new Map();

  for (const row of rows) {
    periodsBySeq.set(row.sequence_number, { name: row.grading_period_name, sequenceNumber: row.sequence_number });
    if (!subjectsById.has(row.subject_id)) {
      subjectsById.set(row.subject_id, { id: row.subject_id, name: row.subject_name, gradesBySeq: new Map() });
    }
    subjectsById.get(row.subject_id).gradesBySeq.set(row.sequence_number, Number(row.grade_value));
  }

  const periods = [...periodsBySeq.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const subjects = [...subjectsById.values()]
    .map((s) => {
      const values = periods.map((p) => {
        const mark = s.gradesBySeq.get(p.sequenceNumber);
        if (mark != null) return mark;
        return wasOffered(s.id, p.sequenceNumber) === false ? NOT_OFFERED : null;
      });
      // Only real numbers average. A NOT_OFFERED cell is not a zero and not
      // a missing mark — the subject was never part of that term.
      const present = values.filter((v) => typeof v === 'number');
      const average = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
      return { name: s.name, values, average };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const allValues = subjects.flatMap((s) => s.values.filter((v) => typeof v === 'number'));
  const generalAverage = allValues.length ? allValues.reduce((a, b) => a + b, 0) / allValues.length : null;

  // Only worth printing a legend when there is something in the table it
  // explains.
  const hasNotOffered = subjects.some((s) => s.values.includes(NOT_OFFERED));

  return { periods, subjects, generalAverage, hasNotOffered };
}

async function generateReportCard(req, res) {
  const studentId = Number(req.params.id);
  const student = await studentModel.findById(req.user, studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const isAdviserOfSection = student.current_section_id
    ? (await sectionModel.getSectionById(student.current_section_id))?.adviser_id === req.user.id
    : false;
  // A student may generate their OWN report card and no one else's. There is
  // no id check needed for that: studentModel.findById above is already
  // scoped (role 'student' -> s.user_id = req.user.id), so any other id has
  // returned 404 by now and never reaches this line. The card itself is
  // built from finalized grades and daily attendance — exactly what the
  // student can already read on their home page, now in the printable form
  // the school hands out on paper.
  const isOwnRecord = req.user.role === 'student';
  if (!['admin', 'registrar'].includes(req.user.role) && !isAdviserOfSection && !isOwnRecord) {
    return res.status(403).json({ error: 'You do not have permission to generate this student’s report card.' });
  }

  // Which school year this card is FOR, resolved once and then used for
  // everything on it. Previously the grades and the attendance summary were
  // pulled across every year the student had ever been enrolled, while the
  // header named only the current one — so a Grade-12 student's card mixed
  // in their Grade-11 marks under a Grade-12 heading, and the general
  // average was computed over both.
  const schoolYearId = await studentModel.resolveSchoolYearId(studentId);
  const schoolYear = schoolYearId ? await schoolYearModel.getById(schoolYearId) : null;

  const [finalizedGrades, attendance, adviserName, sectionOfferings] = await Promise.all([
    gradeModel.getFinalizedHistoryForStudent(studentId, schoolYearId),
    // Bounded by the same year's dates, so the attendance summary counts the
    // days that belong to this card and no others.
    dailyAttendanceModel.getHistoryForStudent(studentId, {
      from: schoolYear?.start_date,
      to: schoolYear?.end_date,
    }),
    sectionModel.getAdviserName(student.current_section_id),
    // The classes this learner's section runs this year, so a cell can say
    // "not taught this term" instead of leaving a dash that also means "no
    // mark yet". Returns [] for a past school year, which is the fail-open
    // case pivotFinalizedGrades expects.
    student.current_section_id ? classOfferingModel.listBySection(student.current_section_id) : [],
  ]);

  const { periods, subjects, generalAverage, hasNotOffered } = pivotFinalizedGrades(
    finalizedGrades,
    sectionOfferings
  );

  const safeName = `${student.last_name}_${student.first_name}`.replace(/[^a-z0-9]+/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_ReportCard.pdf"`);

  const doc = buildReportCardPdf({
    school: SCHOOL,
    student,
    schoolYearLabel: schoolYear?.label,
    periods,
    subjects,
    generalAverage,
    hasNotOffered,
    attendance: attendance.summary,
    adviserName,
    generatedAt: new Date(),
  });
  doc.pipe(res);
  doc.end();
}

module.exports = { generateReportCard, pivotFinalizedGrades, NOT_OFFERED };
