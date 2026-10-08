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
const schoolYearModel = require('../models/schoolYearModel');
const { buildReportCardPdf } = require('../services/reportCardPdf');

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
function pivotFinalizedGrades(rows) {
  const periodsBySeq = new Map();
  const subjectsByName = new Map();

  for (const row of rows) {
    periodsBySeq.set(row.sequence_number, { name: row.grading_period_name, sequenceNumber: row.sequence_number });
    if (!subjectsByName.has(row.subject_name)) {
      subjectsByName.set(row.subject_name, { name: row.subject_name, gradesBySeq: new Map() });
    }
    subjectsByName.get(row.subject_name).gradesBySeq.set(row.sequence_number, Number(row.grade_value));
  }

  const periods = [...periodsBySeq.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const subjects = [...subjectsByName.values()]
    .map((s) => {
      const values = periods.map((p) => s.gradesBySeq.get(p.sequenceNumber) ?? null);
      const present = values.filter((v) => v != null);
      const average = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
      return { name: s.name, values, average };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const allValues = subjects.flatMap((s) => s.values.filter((v) => v != null));
  const generalAverage = allValues.length ? allValues.reduce((a, b) => a + b, 0) / allValues.length : null;

  return { periods, subjects, generalAverage };
}

async function generateReportCard(req, res) {
  const studentId = Number(req.params.id);
  const student = await studentModel.findById(req.user, studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const isAdviserOfSection = student.current_section_id
    ? (await sectionModel.getSectionById(student.current_section_id))?.adviser_id === req.user.id
    : false;
  if (!['admin', 'registrar'].includes(req.user.role) && !isAdviserOfSection) {
    return res.status(403).json({ error: 'You do not have permission to generate this student’s report card.' });
  }

  const [finalizedGrades, attendance, adviserName, currentSchoolYear] = await Promise.all([
    gradeModel.getFinalizedHistoryForStudent(studentId),
    dailyAttendanceModel.getHistoryForStudent(studentId),
    sectionModel.getAdviserName(student.current_section_id),
    schoolYearModel.getCurrentSchoolYear(),
  ]);

  const { periods, subjects, generalAverage } = pivotFinalizedGrades(finalizedGrades);

  const safeName = `${student.last_name}_${student.first_name}`.replace(/[^a-z0-9]+/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_ReportCard.pdf"`);

  const doc = buildReportCardPdf({
    school: SCHOOL,
    student,
    schoolYearLabel: currentSchoolYear?.label,
    periods,
    subjects,
    generalAverage,
    attendance: attendance.summary,
    adviserName,
    generatedAt: new Date(),
  });
  doc.pipe(res);
  doc.end();
}

module.exports = { generateReportCard };
