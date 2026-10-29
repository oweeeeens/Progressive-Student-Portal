// Builds the two sample spreadsheets for the adviser demo, matched to the
// data that is actually on the Railway deployment:
//   - 36 learners, LRNs 100000000001..100000000036
//   - sections STEM A / STEM B / ABM A, school year 2026-06-01..2027-03-31
//   - daily attendance already recorded 2026-06-02..2026-10-02
//
// Both files are built to demonstrate the VALIDATION, not just the happy
// path — a file where everything passes shows less than one where the bad
// rows are caught, named, and the good rows still import.
const path = require('path');
const ExcelJS = require(path.join(__dirname, '..', 'backend', 'node_modules', 'exceljs'));

const OUT = __dirname;

// ---------------------------------------------------------------------------
// 1. Student bulk import
// ---------------------------------------------------------------------------
// Column order and labels come from backend/config/bulkImport.js, which is
// what the downloadable template writes. Keeping them identical means the
// importer's auto-mapping matches every column on the first screen with no
// manual correction — the demo gets to show the mapping being RIGHT.
const STUDENT_HEADERS = [
  'LRN',
  'First Name',
  'Middle Name',
  'Last Name',
  'Sex (M/F)',
  'Date of Birth',
  'Address',
  'Personal Email',
  'Guardian Name',
  'Guardian Contact Number',
  'Section',
  'PWD',
  '4Ps Recipient',
  'ALS Graduate',
  'Last School Attended (used to detect ALS)',
];

// LRNs in the 3100000000xx block: twelve digits, and nowhere near the
// 1000000000xx block the seeded 36 learners occupy, so nothing collides.
const GOOD_STUDENTS = [
  ['310000000001', 'Andrea', 'Santos', 'Bautista', 'F', '2009-02-14', 'Molino IV, Bacoor City, Cavite', 'andrea.bautista@example.com', 'Mr./Mrs. Bautista', '09171112221', 'ABM A', 'No', 'No', 'No', 'Bacoor National High School'],
  ['310000000002', 'Miguel', 'Reyes', 'Dizon', 'M', '2009-07-03', 'Talaba V, Bacoor City, Cavite', 'miguel.dizon@example.com', 'Mr./Mrs. Dizon', '09171112222', 'ABM A', 'No', 'Yes', 'No', 'Bacoor National High School'],
  ['310000000003', 'Patricia', 'Lim', 'Esguerra', 'F', '2009-11-20', 'Zapote III, Bacoor City, Cavite', 'patricia.esguerra@example.com', 'Mr./Mrs. Esguerra', '09171112223', 'ABM A', 'Yes', 'No', 'No', 'St. Dominic Academy'],
  // The ALS row: "Last School Attended" names an ALS centre, so the importer
  // pre-ticks ALS graduate and asks a human to confirm it rather than
  // trusting its own guess. Worth showing — it is a judgement the system
  // deliberately refuses to make on its own.
  ['310000000004', 'Rafael', 'Cruz', 'Fajardo', 'M', '2008-04-09', 'Niog I, Bacoor City, Cavite', 'rafael.fajardo@example.com', 'Mr./Mrs. Fajardo', '09171112224', 'ABM A', 'No', 'Yes', '', 'ALS Bacoor Community Learning Center'],
  ['310000000005', 'Camille', 'Ortega', 'Gutierrez', 'F', '2009-09-27', 'Habay II, Bacoor City, Cavite', 'camille.gutierrez@example.com', 'Mr./Mrs. Gutierrez', '09171112225', 'STEM A', 'No', 'No', 'No', 'Bacoor National High School'],
  ['310000000006', 'Joshua', 'Navarro', 'Herrera', 'M', '2009-01-16', 'Queens Row, Bacoor City, Cavite', 'joshua.herrera@example.com', 'Mr./Mrs. Herrera', '09171112226', 'STEM A', 'No', 'No', 'No', 'Bacoor National High School'],
  // No email and no section: both optional. Shows that a sparse row is
  // imported rather than rejected — the registrar fills the gaps later.
  ['310000000007', 'Bianca', '', 'Ilagan', 'F', '2009-06-05', 'Mambog III, Bacoor City, Cavite', '', 'Mr./Mrs. Ilagan', '09171112227', '', 'No', 'No', 'No', ''],
  ['310000000008', 'Enrico', 'Villanueva', 'Jimenez', 'M', '2008-12-01', 'Banalo, Bacoor City, Cavite', 'enrico.jimenez@example.com', 'Mr./Mrs. Jimenez', '09171112228', 'STEM B', 'No', 'No', 'No', 'Imus National High School'],
];

// Three rows that must FAIL, each on a different rule, each a mistake a real
// clerk makes. The importer names the row number and the reason, imports the
// eight good rows anyway, and lets the registrar fix these and re-upload.
const BAD_STUDENTS = [
  // 11 digits — the classic Excel problem, a leading zero eaten by the cell
  // being formatted as a number.
  ['31000000009', 'Katrina', 'Mendoza', 'Lazaro', 'F', '2009-03-22', 'Molino II, Bacoor City, Cavite', 'katrina.lazaro@example.com', 'Mr./Mrs. Lazaro', '09171112229', 'ABM A', 'No', 'No', 'No', ''],
  // An LRN that is already in the system — Eve Garcia, ABM A.
  ['100000000025', 'Duplicate', 'Of', 'Existing', 'F', '2009-05-01', 'Bacoor City, Cavite', 'duplicate.existing@example.com', 'Mr./Mrs. Existing', '09171112230', 'ABM A', 'No', 'No', 'No', ''],
  // Section written the way it appears in the UI ("Grade 11 - ABM A")
  // rather than as the section's own name. The matcher compares the bare
  // name, so this is not found.
  ['310000000010', 'Section', 'Name', 'Mismatch', 'M', '2009-08-30', 'Bacoor City, Cavite', 'section.mismatch@example.com', 'Mr./Mrs. Mismatch', '09171112231', 'Grade 11 - ABM A', 'No', 'No', 'No', ''],
];

async function buildStudentImport() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.addRow(STUDENT_HEADERS).font = { bold: true };
  STUDENT_HEADERS.forEach((_, i) => {
    ws.getColumn(i + 1).width = 22;
  });
  // Interleaved rather than all-good-then-all-bad, so the review screen
  // shows the importer sorting them out rather than the file being tidy.
  const rows = [
    GOOD_STUDENTS[0], GOOD_STUDENTS[1], BAD_STUDENTS[0], GOOD_STUDENTS[2],
    GOOD_STUDENTS[3], BAD_STUDENTS[1], GOOD_STUDENTS[4], GOOD_STUDENTS[5],
    BAD_STUDENTS[2], GOOD_STUDENTS[6], GOOD_STUDENTS[7],
  ];
  // LRNs written as TEXT. As a number Excel would strip a leading zero and
  // render long values in scientific notation, which is the single most
  // common way a real SF-based import goes wrong.
  for (const r of rows) {
    const row = ws.addRow(r);
    row.getCell(1).numFmt = '@';
  }
  const out = path.join(OUT, 'students-import-sample.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('wrote', out, `(${rows.length} rows: ${GOOD_STUDENTS.length} valid, ${BAD_STUDENTS.length} deliberately invalid)`);
}

// ---------------------------------------------------------------------------
// 2. SF2 attendance import
// ---------------------------------------------------------------------------
// Shaped like the DepEd form the school actually keeps: a header block, a
// row of day numbers, one row per learner, a mark per cell. The parser finds
// the LRN column by counting 12-digit hits and the day row by looking for
// the longest ascending run of 1..31, so the header block above is skipped
// without the parser having to recognise any of it.
const ABM_A = [
  ['100000000025', 'GARCIA, Eve'],
  ['100000000026', 'TORRES, Fred'],
  ['100000000027', 'LIM, Grace'],
  ['100000000028', 'MARQUEZ, Hector'],
  ['100000000029', 'NOLASCO, Isabel'],
  ['100000000030', 'ORTEGA, Jay'],
  ['100000000031', 'PADILLA, Karen'],
  ['100000000032', 'QUIJANO, Lance'],
  ['100000000033', 'ROSALES, Mia'],
  ['100000000034', 'SUAREZ, Noel'],
  ['100000000035', 'TAN, Olivia'],
  ['100000000036', 'UY, Paolo'],
];

// 1 and 2 October are ALREADY recorded on the deployment (the seed fills
// 2026-06-02..2026-10-02), so including them forces the overwrite-or-skip
// decision — the most defensible thing in the whole importer, and invisible
// on a file that happens not to overlap. 5-9 October are new.
const DAYS = [1, 2, 5, 6, 7, 8, 9];

const MARKS = {
  '100000000025': ['', '', 'A', '', '', 'L', ''],
  '100000000026': ['', '', '', '', '', '', ''],
  '100000000027': ['', '', '', '', '', '', ''],
  '100000000028': ['A', 'A', 'A', '', '', '', ''],
  '100000000029': ['', 'L', '', '', '', '', ''],
  '100000000030': ['', '', '', 'E', '', '', ''],
  '100000000031': ['', '', '', '', '', '', 'A'],
  '100000000032': ['', '', '', '', '', '', ''],
  // A stray mark the importer must not guess at — it stops and asks what
  // "H" means before writing anything.
  '100000000033': ['L', '', 'H', '', 'A', 'A', 'A'],
  '100000000034': ['', '', '', '', '', '', ''],
  '100000000035': ['', '', '', '', '', '', ''],
  '100000000036': ['', 'A', '', '', '', '', ''],
};

async function buildSf2() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SF2');

  ws.addRow(['School Form 2 (SF2) Daily Attendance Report of Learners']);
  ws.addRow(['School: DepEd Progressive Senior High School - Bacoor City']);
  ws.addRow(['School Year: 2026-2027', '', 'Month: OCTOBER 2026']);
  ws.addRow(['Grade & Section: Grade 11 - ABM A']);
  ws.addRow([]);
  ws.addRow(['LRN', "LEARNER'S NAME (Last Name, First Name)", ...DAYS]).font = { bold: true };

  for (const [lrn, name] of ABM_A) {
    const row = ws.addRow([lrn, name, ...MARKS[lrn]]);
    row.getCell(1).numFmt = '@';
  }
  // A learner from STEM A: in the school, but not in this section. Reported
  // and never written into the wrong register.
  ws.addRow(['100000000002', 'CRUZ, Ben', '', '', '', '', '', '', '']).getCell(1).numFmt = '@';
  // The same learner twice — an easy mistake when a sheet is assembled by
  // hand. The first row wins and the second is reported.
  ws.addRow(['100000000025', 'GARCIA, Eve (duplicate row)', 'A', 'A', 'A', 'A', 'A', 'A', 'A']).getCell(1).numFmt = '@';

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 36;

  const out = path.join(OUT, 'sf2-attendance-sample.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('wrote', out, `(${ABM_A.length} ABM A learners + 1 outsider + 1 duplicate, ${DAYS.length} days, 2 of them already recorded)`);
}

(async () => {
  await buildStudentImport();
  await buildSf2();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
