// Excel exports of the panel's reports, with the same header style and
// "Report Info" sheet as the Analytics workbook (workbookPrimitives.js).
// Each builder takes the data object the page shows (reportBuilder.js) and
// resolves to an .xlsx buffer. Numbers are written as numbers, and a missing
// grade as an empty cell — never a 0 that would skew a sum or average.
const ExcelJS = require('exceljs');
const { addSheet, addInfoSheet, orBlank } = require('./workbookPrimitives');
const { CLASS_TERM_LABELS } = require('../config/academicTerms');
const { STATUS_LABELS, SEX_LABELS, filterRows } = require('./reportPdf');

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
  addClassGradesSheet(workbook, 'Grades', data);
  return workbook.xlsx.writeBuffer();
}

// One class's learners, with each period's grade and stage side by side —
// shared by the single-class and all-classes workbooks.
function addClassGradesSheet(workbook, name, data) {
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
  return addSheet(workbook, name, columns, rows);
}

// ALL OF A TEACHER'S CLASSES — Report Info listing every class, then one
// sheet per class. Sheet names must be unique and ≤ 31 characters, so a
// clash gets a number.
async function buildAllClassGradesWorkbook(data) {
  const workbook = newWorkbook();
  addInfoSheet(workbook, [
    { item: 'Report', value: 'Class grade report — all classes' },
    { item: 'Classes', value: data.scopeLabel },
    { item: 'School year', value: data.schoolYear || '—' },
    { item: 'Number of classes', value: data.classes.length },
    { item: 'Generated on', value: today(data.generatedAt) },
    ...data.classes.map((c, i) => ({
      item: `Class ${i + 1}`,
      value: `Grade ${c.offering.gradeLevel} – ${c.offering.sectionName} · ${c.offering.subjectName} · ${c.offering.teacherName || '—'} · ${c.studentCount} learners`,
    })),
  ]);
  const used = new Set(['Report Info']);
  for (const cls of data.classes) {
    const base = sheetName(`${cls.offering.sectionName} ${cls.offering.subjectCode || cls.offering.subjectName}`);
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = sheetName(`${base.slice(0, 27)} (${n})`);
    used.add(name);
    addClassGradesSheet(workbook, name, cls);
  }
  return workbook.xlsx.writeBuffer();
}

// ENROLLED STUDENT LIST — Report Info, Learners, and By Section.
async function buildEnrolledListWorkbook(data) {
  const workbook = newWorkbook();
  addInfoSheet(workbook, [
    { item: 'Report', value: 'Enrolled student list' },
    ...filterRows(data).map(([item, value]) => ({ item, value })),
    { item: 'School year', value: data.schoolYear || '—' },
    { item: 'Learners', value: data.total },
    { item: 'Male', value: data.bySex.M },
    { item: 'Female', value: data.bySex.F },
    { item: 'Generated on', value: today(data.generatedAt) },
  ]);
  addSheet(
    workbook,
    'Learners',
    [
      { header: 'LRN', key: 'lrn', width: 16 },
      { header: 'Learner', key: 'name', width: 32 },
      { header: 'Sex', key: 'sex', width: 8 },
      { header: 'Grade level', key: 'grade', width: 12 },
      { header: 'Section', key: 'section', width: 16 },
      { header: 'Strand', key: 'strand', width: 10 },
      { header: 'Adviser', key: 'adviser', width: 26 },
      { header: 'Enrollment status', key: 'status', width: 18 },
      { header: 'Subjects enrolled', key: 'subjects', width: 16 },
    ],
    data.students.map((s) => ({
      lrn: s.lrn,
      name: s.name,
      sex: SEX_LABELS[s.sex] || '',
      grade: s.gradeLevel,
      section: s.sectionName,
      strand: s.strand || '',
      adviser: s.adviserName || '',
      status: s.enrollmentStatus,
      subjects: s.subjectCount,
    }))
  );
  addSheet(
    workbook,
    'By Section',
    [
      { header: 'Grade level', key: 'grade', width: 12 },
      { header: 'Section', key: 'section', width: 18 },
      { header: 'Strand', key: 'strand', width: 10 },
      { header: 'Learners', key: 'count', width: 12 },
    ],
    [
      ...data.bySection.map((s) => ({ grade: s.gradeLevel, section: s.sectionName, strand: s.strand || '', count: s.count })),
      { grade: '', section: 'Total', strand: '', count: data.total },
    ]
  );
  return workbook.xlsx.writeBuffer();
}

// ADMIN MONITORING — Report Info, Sections, Classes.
async function buildMonitoringWorkbook(data) {
  const workbook = newWorkbook();
  const t = data.totals;
  addInfoSheet(workbook, [
    { item: 'Report', value: 'Admin monitoring' },
    { item: 'Grading period', value: data.period.name },
    { item: 'School year', value: data.period.schoolYear || '—' },
    { item: 'Learners', value: t.learners },
    { item: 'Class enrollments', value: t.enrollments },
    { item: 'At risk (any factor)', value: t.atRisk.total },
    { item: 'Assessed', value: t.assessed },
    { item: 'Generated on', value: today(data.generatedAt) },
    { item: 'Note', value: 'At risk = risk score above 0, as on Analytics. Missing = enrolled learners with no grade for the period.' },
  ]);
  addSheet(
    workbook,
    'Sections',
    [
      { header: 'Grade level', key: 'grade', width: 12 },
      { header: 'Section', key: 'section', width: 18 },
      { header: 'Strand', key: 'strand', width: 10 },
      { header: 'Adviser', key: 'adviser', width: 26 },
      { header: 'Learners', key: 'learners', width: 10 },
      { header: 'Classes', key: 'classes', width: 10 },
      { header: 'Enrollments', key: 'enrollments', width: 12 },
      { header: 'Assessed', key: 'assessed', width: 10 },
      { header: 'At risk', key: 'atRisk', width: 10 },
      { header: 'High', key: 'high', width: 8 },
      { header: 'Medium', key: 'medium', width: 9 },
      { header: 'Low', key: 'low', width: 8 },
    ],
    data.sections.map((s) => ({
      grade: s.gradeLevel, section: s.sectionName, strand: s.strand || '', adviser: s.adviserName || '',
      learners: s.learners, classes: s.classes, enrollments: s.enrollments, assessed: s.assessed,
      atRisk: s.atRisk.total, high: s.atRisk.high, medium: s.atRisk.medium, low: s.atRisk.low,
    }))
  );
  addSheet(
    workbook,
    'Classes',
    [
      { header: 'Grade level', key: 'grade', width: 12 },
      { header: 'Section', key: 'section', width: 16 },
      { header: 'Subject', key: 'subject', width: 36 },
      { header: 'Teacher', key: 'teacher', width: 26 },
      { header: 'Enrolled', key: 'enrolled', width: 10 },
      { header: 'Submitted', key: 'submitted', width: 11 },
      { header: 'Verified', key: 'verified', width: 10 },
      { header: 'Finalized', key: 'finalized', width: 10 },
      { header: 'Returned', key: 'rejected', width: 10 },
      { header: 'Missing', key: 'missing', width: 10 },
    ],
    data.classes.map((c) => ({
      grade: c.gradeLevel, section: c.sectionName, subject: c.subjectName, teacher: c.teacherName || '',
      enrolled: c.enrolled, submitted: c.submitted, verified: c.verified, finalized: c.finalized, rejected: c.rejected, missing: c.missing,
    }))
  );
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildGradesheetWorkbook, buildClassGradesWorkbook, buildAllClassGradesWorkbook, buildEnrolledListWorkbook, buildMonitoringWorkbook };
