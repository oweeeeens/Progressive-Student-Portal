// Excel exports of the panel's reports, with the same header style and
// "Report Info" sheet as the Analytics workbook (workbookPrimitives.js).
// Each builder takes the data object the page shows (reportBuilder.js) and
// resolves to an .xlsx buffer. Numbers are written as numbers, and a missing
// grade as an empty cell — never a 0 that would skew a sum or average.
const ExcelJS = require('exceljs');
const { addSheet, addInfoSheet, orBlank } = require('./workbookPrimitives');
const { CLASS_TERM_LABELS } = require('../config/academicTerms');
const { STATUS_LABELS } = require('./reportPdf');

const runsLabel = (s) => (s.subjectCategory === 'specialized' ? CLASS_TERM_LABELS.full_year : CLASS_TERM_LABELS[s.term] || CLASS_TERM_LABELS.full_year);
const today = (d) => d.toISOString().slice(0, 10);

function newWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Student Portal';
  workbook.created = new Date();
  return workbook;
}

// Excel sheet names: at most 31 characters, none of : \ / ? * [ ].
const sheetName = (text) => String(text).replace(/[:\\/?*[\]]/g, '-').slice(0, 31);

// ADVISER GRADESHEET — Report Info, one sheet per grading period, Subjects.
async function buildGradesheetWorkbook(data) {
  const workbook = newWorkbook();
  addInfoSheet(workbook, [
    { item: 'Report', value: 'Adviser gradesheet — finalized grades only' },
    { item: 'Section', value: `Grade ${data.section.gradeLevel} – ${data.section.name}` },
    { item: 'Strand', value: data.section.strand || '—' },
    { item: 'School year', value: data.section.schoolYear || '—' },
    { item: 'Adviser', value: data.section.adviserName || '—' },
    { item: 'Learners', value: data.studentCount },
    { item: 'Generated on', value: today(data.generatedAt) },
    { item: 'Note', value: 'Blank = not finalized yet. Average = average of the grades finalized so far.' },
  ]);

  for (const period of data.periods) {
    const columns = [
      { header: 'LRN', key: 'lrn', width: 16 },
      { header: 'Learner', key: 'name', width: 32 },
      ...period.subjects.map((s, i) => ({ header: s.subjectName, key: `s${i}`, width: 16 })),
      { header: 'Average (finalized)', key: 'average', width: 18 },
      { header: 'Finalized', key: 'finalized', width: 12 },
    ];
    const rows = period.rows.map((r) => ({
      lrn: r.lrn,
      name: r.name,
      ...Object.fromEntries(r.grades.map((g, i) => [`s${i}`, orBlank(g)])),
      average: orBlank(r.average),
      finalized: `${r.finalizedCount} of ${period.subjects.length}`,
    }));
    addSheet(workbook, sheetName(period.periodName), columns, rows);
  }

  addSheet(
    workbook,
    'Subjects',
    [
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Subject', key: 'subject', width: 40 },
      { header: 'Teacher', key: 'teacher', width: 28 },
      { header: 'Runs', key: 'runs', width: 18 },
    ],
    data.subjects.map((s) => ({ code: s.subjectCode || '', subject: s.subjectName, teacher: s.teacherName || '', runs: runsLabel(s) }))
  );
  return workbook.xlsx.writeBuffer();
}

// SUBJECT TEACHER'S CLASS GRADE REPORT — Report Info and one Grades sheet,
// with each period's grade and its approval stage side by side.
async function buildClassGradesWorkbook(data) {
  const workbook = newWorkbook();
  const o = data.offering;
  addInfoSheet(workbook, [
    { item: 'Report', value: 'Class grade report' },
    { item: 'Subject', value: o.subjectCode ? `${o.subjectName} (${o.subjectCode})` : o.subjectName },
    { item: 'Section', value: `Grade ${o.gradeLevel} – ${o.sectionName}` },
    { item: 'School year', value: o.schoolYear || '—' },
    { item: 'Teacher', value: o.teacherName || '—' },
    { item: 'Learners enrolled', value: data.studentCount },
    { item: 'Generated on', value: today(data.generatedAt) },
  ]);
  const columns = [
    { header: 'LRN', key: 'lrn', width: 16 },
    { header: 'Learner', key: 'name', width: 32 },
    ...data.periods.flatMap((p, i) => [
      { header: `${p.periodName} grade`, key: `g${i}`, width: 14 },
      { header: `${p.periodName} status`, key: `st${i}`, width: 14 },
    ]),
    { header: 'Finalized average', key: 'avg', width: 18 },
  ];
  const rows = data.rows.map((r) => ({
    lrn: r.lrn,
    name: r.name,
    ...Object.fromEntries(r.cells.flatMap((c, i) => [[`g${i}`, c ? c.value : null], [`st${i}`, c ? STATUS_LABELS[c.status] : 'Not submitted']])),
    avg: orBlank(r.finalizedAverage),
  }));
  addSheet(workbook, 'Grades', columns, rows);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildGradesheetWorkbook, buildClassGradesWorkbook };
