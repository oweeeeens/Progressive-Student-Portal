// Reads DepEd's official e-Class Record (ECR) workbook into plain data.
//
// SOURCE OF THE LAYOUT. The official SY 2026–2027 Senior High School ECR
// ("ECR_3Term – SHS G12 – SY2026-2027"), read cell by cell. Its sheets are
// INSTRUCTIONS, INPUT DATA, Term 1, Term 2, Term 3, FINAL GRADES, HELPER.
// The Strengthened SHS workbook has the same tabs and the same exam columns
// (only its weights differ — and the System computes with the subject's own
// DepEd weight group, so that difference does not matter here).
//
//   INPUT DATA   learner lists, numbered 1..n from row 11:
//                  MALE   — LRN in column N, name in column O
//                  FEMALE — LRN in column R, name in column S
//   Term N       row 9: SECTION (N9), SUBJECT (U9); row 10: TEACHER (H10)
//                row 14: HIGHEST POSSIBLE SCORE
//                WW 1–10 = columns D–M   (N/O/P = total, PS, WS)
//                PT 1–10 = columns Q–Z   (AA/AB/AC = total, PS, WS)
//                EX      = AD (Summative Test 1), AE (Summative Test 2), AF (Term Exam)
//                AL = Initial Grade, AM = Term Grade (computed by the workbook)
//                learner name in column C; MALE rows 17–66, FEMALE rows 68–117
//                (male #k is row 16+k and female #k is row 67+k)
//
// Everything is read from the CACHED values Excel saved with the file, so a
// workbook filled in and saved in Excel reads exactly as the teacher sees it.
// Pure parsing only — matching learners and deciding what to write lives in
// services/eclassRecordImport.js.
const ExcelJS = require('exceljs');
const { normalizeCellValue } = require('../utils/spreadsheetCell');

const LAYOUT = {
  hpsRow: 14,
  sectionCell: 'N9',
  subjectCell: 'U9',
  teacherCell: 'H10',
  nameColumn: 'C',
  initialGradeColumn: 'AL',
  termGradeColumn: 'AM',
  blocks: [
    { gender: 'male', firstRow: 17, lastRow: 66, lrnColumn: 'N', nameColumn: 'O' },
    { gender: 'female', firstRow: 68, lastRow: 117, lrnColumn: 'R', nameColumn: 'S' },
  ],
  inputDataFirstRow: 11,
};

// The item columns, in DepEd's order, with the title each becomes in the
// System's class record.
const ITEM_COLUMNS = [
  ...['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].map((col, i) => ({ col, key: `ww${i + 1}`, component: 'ww', examPart: null, title: `Written Work ${i + 1}` })),
  ...['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map((col, i) => ({ col, key: `pt${i + 1}`, component: 'pt', examPart: null, title: `Performance Task ${i + 1}` })),
  { col: 'AD', key: 'st1', component: 'ex', examPart: 'st1', title: 'Summative Test 1' },
  { col: 'AE', key: 'st2', component: 'ex', examPart: 'st2', title: 'Summative Test 2' },
  { col: 'AF', key: 'te', component: 'ex', examPart: 'te', title: 'Term Examination' },
];

const TERM_SHEETS = [
  { sequence: 1, names: ['term 1', 'first term'] },
  { sequence: 2, names: ['term 2', 'second term'] },
  { sequence: 3, names: ['term 3', 'third term'] },
];

function text(sheet, address) {
  const value = normalizeCellValue(sheet.getCell(address).value);
  return value === null ? '' : String(value).trim();
}

// A number from a cell, or null when blank/non-numeric. A real 0 stays 0.
function number(sheet, address) {
  const raw = normalizeCellValue(sheet.getCell(address).value);
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function findSheet(workbook, names) {
  return workbook.worksheets.find((ws) => names.includes(ws.name.trim().toLowerCase())) || null;
}

// Throws a readable error when the file is not an e-Class Record, so the
// teacher is told what was expected instead of seeing an empty import.
function assertIsEclassRecord(workbook) {
  const inputData = findSheet(workbook, ['input data']);
  const anyTerm = TERM_SHEETS.some((t) => findSheet(workbook, t.names));
  if (!inputData || !anyTerm) {
    throw new Error(
      "This file is not a DepEd e-Class Record: it needs an 'INPUT DATA' sheet and 'Term 1' to 'Term 3' sheets. " +
        "Upload the workbook the teacher fills in for this subject."
    );
  }
  const sample = findSheet(workbook, TERM_SHEETS[0].names) || findSheet(workbook, TERM_SHEETS[1].names) || findSheet(workbook, TERM_SHEETS[2].names);
  if (!/HIGHEST POSSIBLE SCORE/i.test(text(sample, `B${LAYOUT.hpsRow}`))) {
    throw new Error("This workbook does not match the DepEd e-Class Record layout (no 'HIGHEST POSSIBLE SCORE' row on the term sheets).");
  }
  return inputData;
}

// LRN by learner number, per gender block, from INPUT DATA.
function readInputData(sheet) {
  const lists = {};
  for (const block of LAYOUT.blocks) {
    lists[block.gender] = [];
    const slots = block.lastRow - block.firstRow + 1;
    for (let k = 1; k <= slots; k += 1) {
      const row = LAYOUT.inputDataFirstRow + k - 1;
      lists[block.gender][k] = {
        lrn: text(sheet, `${block.lrnColumn}${row}`).replace(/\D/g, '') || null,
        name: text(sheet, `${block.nameColumn}${row}`) || null,
      };
    }
  }
  return lists;
}

function readTermSheet(sheet, sequence, inputData) {
  const items = ITEM_COLUMNS
    .map((c) => ({ ...c, highestPossibleScore: number(sheet, `${c.col}${LAYOUT.hpsRow}`) }))
    .filter((c) => c.highestPossibleScore !== null && c.highestPossibleScore > 0)
    .map(({ key, component, examPart, title, highestPossibleScore }) => ({ key, component, examPart, title, highestPossibleScore }));

  const learners = [];
  for (const block of LAYOUT.blocks) {
    for (let row = block.firstRow; row <= block.lastRow; row += 1) {
      const name = text(sheet, `${LAYOUT.nameColumn}${row}`);
      const k = row - block.firstRow + 1;
      const listed = inputData[block.gender][k] || {};
      if (!name && !listed.name) continue;
      const scores = {};
      for (const item of items) {
        const col = ITEM_COLUMNS.find((c) => c.key === item.key).col;
        const value = number(sheet, `${col}${row}`);
        if (value !== null) scores[item.key] = value;
      }
      learners.push({
        row,
        gender: block.gender,
        name: name || listed.name,
        lrn: listed.lrn,
        scores,
        sheetInitialGrade: number(sheet, `${LAYOUT.initialGradeColumn}${row}`),
        sheetTermGrade: number(sheet, `${LAYOUT.termGradeColumn}${row}`),
      });
    }
  }
  return {
    sequence,
    sheetName: sheet.name,
    section: text(sheet, LAYOUT.sectionCell),
    subject: text(sheet, LAYOUT.subjectCell),
    teacher: text(sheet, LAYOUT.teacherCell),
    items,
    learners,
  };
}

// The whole workbook → { terms: [...] }. A term sheet with no highest
// possible scores filled in (not started yet) is left out.
async function parseEclassRecord(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('The file could not be read as an Excel workbook (.xlsx).');
  }
  const inputSheet = assertIsEclassRecord(workbook);
  const inputData = readInputData(inputSheet);
  const terms = [];
  for (const t of TERM_SHEETS) {
    const sheet = findSheet(workbook, t.names);
    if (!sheet) continue;
    const term = readTermSheet(sheet, t.sequence, inputData);
    if (term.items.length > 0) terms.push(term);
  }
  if (terms.length === 0) {
    throw new Error('No term in this workbook has highest possible scores filled in yet, so there is nothing to import.');
  }
  return { terms };
}

module.exports = { parseEclassRecord, LAYOUT, ITEM_COLUMNS };
