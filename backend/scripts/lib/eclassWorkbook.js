// Builds a workbook in DepEd's e-Class Record (ECR) layout — the template a
// teacher downloads from Import Data, the demo sample file
// (scripts/makeSampleEclassRecord.js) and the integration tests' fixtures.
//
// WHAT IT LOOKS LIKE, AND WHY. It follows DepEd's official SY 2026–2027 SHS
// ECR, read cell by cell: the same sheets, the same cells, the same column
// widths, merged header bands and colours (grey component headers,
// light-blue item numbers, grey TOTAL/PS/WS columns, blue-tinted MALE and
// gold-tinted FEMALE numbers, a dark LEARNERS' NAMES bar), frozen headers and
// no gridlines. Teachers already know that sheet; a template that looks like
// it is one they can fill in without being taught.
//
// IT COMPUTES, LIVE. Every learner row carries formulas for each component's
// total, Percentage Score and Weighted Score, the exam parts, the Initial
// Grade and the Term Grade — the same steps, in the same order and with the
// same rounding, as services/gradeCalculator.js, and with THIS CLASS's DepEd
// weight group (config/gradingPolicy.js — no number is typed twice). So the
// teacher sees each grade in Excel as they type, and when the file comes back
// the import's cross-check compares Excel's Term Grade with the System's.
//
// WHAT THE IMPORT READS is only the raw input — the highest possible scores
// in row 14 and the scores — plus the cached Term Grade for the cross-check.
// Those cells are exactly where services/eclassRecordParser.js expects them
// (LAYOUT, ITEM_COLUMNS), so styling and formulas cannot change what is
// imported. Formulas are written with no cached result, and the workbook is
// flagged to recalculate when Excel opens it.
//
// Excel 2013 compatible on purpose (the school's Excel): no XLOOKUP, IFS or
// dynamic arrays — the Term Grade is an approximate-match VLOOKUP (the final
// argument 1 means TRUE) into a hidden HELPER sheet.
const ExcelJS = require('exceljs');
const { LAYOUT, ITEM_COLUMNS } = require('../../services/eclassRecordParser');
const {
  WEIGHT_GROUPS,
  DEFAULT_WEIGHT_GROUP,
  EXAM_PARTS,
  TERM_EXAM_ONLY_GROUPS,
  TRANSMUTATION_TABLE,
  GRADING_MODE,
  MINIMUM_REPORTABLE_GRADE,
  PASSING_GRADE,
} = require('../../config/gradingPolicy');

// DepEd's palette, resolved from the official workbook's theme colours.
const COLOURS = {
  componentHeader: 'FFF2F2F2', // white, 5% darker — the WW/PT/EX bands
  itemNumber: 'FFDAE3F3', //      accent 1 (#4472C4), 80% lighter — row 13
  computed: 'FFE7E6E6', //        light 2 — TOTAL / PS / WS columns
  maleNumber: 'FFD6DCE4', //      dark 2 (#44546A), 80% lighter
  femaleNumber: 'FFFFF2CC', //    accent 4 (#FFC000), 80% lighter
  namesBar: 'FF000000', //        LEARNERS' NAMES
  genderBar: 'FF595959', //       MALE / FEMALE
  notGraded: 'FFBFBFBF', //       exam columns a subject does not use
  belowPassingFill: 'FFFFC7CE', // Excel's own "light red fill"
  belowPassingText: 'FF9C0006',
  white: 'FFFFFFFF',
  subjectText: 'FF0046D2', //     DepEd prints the subject in blue
};

const FONT = 'Calibri';
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const medium = { style: 'medium', color: { argb: 'FF000000' } };

// The computed columns, in DepEd's positions, beside the item columns the
// parser reads (D–M, Q–Z, AD–AF).
const COMPUTED = {
  ww: { first: 'D', last: 'M', total: 'N', ps: 'O', ws: 'P' },
  pt: { first: 'Q', last: 'Z', total: 'AA', ps: 'AB', ws: 'AC' },
  ex: {
    parts: [
      { key: 'st1', input: 'AD', weighted: 'AG', label: 'ST 1', weightedLabel: 'WS ST1' },
      { key: 'st2', input: 'AE', weighted: 'AH', label: 'ST 2', weightedLabel: 'WS ST2' },
      { key: 'te', input: 'AF', weighted: 'AI', label: 'TE', weightedLabel: 'WS TE' },
    ],
    ps: 'AJ',
    ws: 'AK',
  },
  initialGrade: LAYOUT.initialGradeColumn, // AL
  termGrade: LAYOUT.termGradeColumn, //       AM
};

const NARROW = 4.33;
const WIDE = 6.66;
const COLUMN_WIDTHS = {
  A: 3.66, B: 3.66, C: 36.66,
  N: WIDE, O: WIDE, P: WIDE, AA: WIDE, AB: WIDE, AC: WIDE,
  AG: WIDE, AH: WIDE, AI: WIDE, AJ: WIDE, AK: WIDE,
  AL: 8.66, AM: 8.66, AN: 3.66,
};

// The HELPER sheet holds the transmutation table ascending, which is what an
// approximate VLOOKUP needs: it returns the row with the largest minimum not
// above the Initial Grade — the same row gradeCalculator.transmute picks
// walking the table from the top.
const HELPER_FIRST_ROW = 2;
const HELPER_LAST_ROW = HELPER_FIRST_ROW + TRANSMUTATION_TABLE.length - 1;

function columnNumber(letters) {
  return letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}
function columnLetters(number) {
  let s = '';
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function columnsBetween(first, last) {
  const out = [];
  for (let n = columnNumber(first); n <= columnNumber(last); n += 1) out.push(columnLetters(n));
  return out;
}

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

// Write a value with a style in one call — the sheets below are mostly this.
function put(ws, address, value, style = {}) {
  const cell = ws.getCell(address);
  if (value !== undefined) cell.value = value;
  cell.font = { name: FONT, size: 10, ...(style.font || {}) };
  if (style.fill) cell.fill = fill(style.fill);
  cell.alignment = style.alignment || { horizontal: 'center', vertical: 'middle' };
  if (style.numFmt) cell.numFmt = style.numFmt;
  if (style.border) cell.border = style.border;
  return cell;
}

// Thin borders on every cell in a rectangle, with a medium edge where DepEd
// draws one (around each component group and the grade columns).
function grid(ws, fromRow, toRow, columns, mediumLeftAt) {
  for (let row = fromRow; row <= toRow; row += 1) {
    for (const col of columns) {
      const cell = ws.getCell(`${col}${row}`);
      cell.border = {
        top: thin,
        bottom: thin,
        left: mediumLeftAt.has(col) ? medium : thin,
        right: col === columns[columns.length - 1] ? medium : thin,
      };
    }
  }
}

// --- formulas ---------------------------------------------------------------
// Each mirrors one step of services/gradeCalculator.js. "A blank is not a
// zero": a component stays blank until every item that has a highest
// possible score also has a score, exactly like the System.

function componentTotalFormula(c, row) {
  const hps = `$${c.first}$${LAYOUT.hpsRow}:$${c.last}$${LAYOUT.hpsRow}`;
  const scores = `${c.first}${row}:${c.last}${row}`;
  const scored = `SUMPRODUCT(--(${hps}<>""),--(${scores}<>""))`;
  return `IFERROR(IF(OR($C${row}="",COUNT(${hps})=0,${scored}<COUNT(${hps})),"",SUMPRODUCT(--(${hps}<>""),${scores})),"")`;
}
function percentageFormula(totalCol, row) {
  return `IF(${totalCol}${row}="","",ROUND(${totalCol}${row}/${totalCol}$${LAYOUT.hpsRow}*100,2))`;
}

// --- sheets -------------------------------------------------------------------

function buildInstructions(wb, spec, weights) {
  const ws = wb.addWorksheet('INSTRUCTIONS', { views: [{ showGridLines: false }] });
  ws.getColumn('A').width = 3;
  ws.getColumn('B').width = 4;
  ws.getColumn('C').width = 100;
  put(ws, 'B2', 'Electronic Class Record', { font: { size: 22, bold: true }, alignment: { horizontal: 'left' } });
  put(ws, 'B3', `${spec.subject || ''}${spec.section ? ` — ${spec.section}` : ''}`, {
    font: { size: 12, bold: true, color: { argb: COLOURS.subjectText } },
    alignment: { horizontal: 'left' },
  });
  const examLine = weights.ex === null
    ? 'This subject has no examinations component.'
    : TERM_EXAM_ONLY_GROUPS.has(spec.weightGroup)
      ? `Examinations ${Math.round(weights.ex * 100)}% — Term Examination only.`
      : `Examinations ${Math.round(weights.ex * 100)}% (Summative Test 1 = 30%, Summative Test 2 = 30%, Term Examination = 40%).`;
  const steps = [
    ['How to fill in this class record', null],
    ['1', 'Open the Term sheet you are grading (Term 1, Term 2 or Term 3). The learners are already listed — do not retype or reorder them.'],
    ['2', "Type the HIGHEST POSSIBLE SCORE of each activity in row 14, under Written / Oral Works, Performance Tasks and Examinations."],
    ['3', "Type each learner's raw score under the activity. A score above the highest possible score is refused."],
    ['4', 'Leave a cell BLANK if the learner has no score yet. A blank is not a zero: that learner gets no grade until every score is in.'],
    ['5', 'The TOTAL, PS (percentage score), WS (weighted score), INITIAL GRADE and TERM GRADE columns compute themselves. Do not type in them.'],
    ['6', 'Save the file, then upload it in the Student Portal: Import Data → e-Class Record. You will review every learner before anything is saved.'],
    [null, null],
    ['How the grade is computed (DepEd Order No. 015, s. 2026, Annex D)', null],
    ['•', `This subject's weights: Written / Oral Works ${Math.round(weights.ww * 100)}%, Performance Tasks ${Math.round(weights.pt * 100)}%. ${examLine}`],
    ['•', 'PS = total raw score ÷ total highest possible score × 100.   WS = PS × weight.   Initial Grade = sum of the WSs.'],
    ['•', GRADING_MODE === 'zero_based'
      ? `Term Grade = the Initial Grade rounded, never below ${MINIMUM_REPORTABLE_GRADE}.`
      : 'Term Grade = the Initial Grade transmuted with DepEd\'s adjusted table for SY 2026–2027 (an Initial Grade of 70.00 is a Term Grade of 75).'],
    ['•', `A Term Grade below ${PASSING_GRADE} is shaded red.`],
  ];
  steps.forEach(([mark, text], i) => {
    const row = 5 + i;
    if (mark && text === null) {
      put(ws, `B${row}`, mark, { font: { size: 12, bold: true }, alignment: { horizontal: 'left' } });
      return;
    }
    if (!mark) return;
    put(ws, `B${row}`, mark, { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'top' } });
    put(ws, `C${row}`, text, { font: { size: 11 }, alignment: { horizontal: 'left', vertical: 'top', wrapText: true } });
    ws.getRow(row).height = 30;
  });
}

function buildInputData(wb, spec, slots, weights) {
  const ws = wb.addWorksheet('INPUT DATA', { views: [{ showGridLines: false, state: 'frozen', ySplit: 10 }] });
  for (const [col, width] of Object.entries({ A: 2, B: 3, C: 16, D: 2, E: 40, F: 3, M: 5, N: 16, O: 34, P: 3, Q: 5, R: 16, S: 34 })) {
    ws.getColumn(col).width = width;
  }
  put(ws, 'D2', 'Input Data Sheet for Electronic Class Record (ECR)', { font: { size: 16, bold: true }, alignment: { horizontal: 'left' } });
  put(ws, 'D3', "List each learner once here, with their LRN. The Term sheets read the names from this list.", {
    font: { italic: true, color: { argb: 'FF595959' } },
    alignment: { horizontal: 'left' },
  });

  // Class information, on the left.
  ws.mergeCells('B8:E8');
  put(ws, 'B8', 'CLASS INFORMATION', { font: { bold: true, color: { argb: COLOURS.white } }, fill: COLOURS.namesBar });
  const info = [
    ['SECTION', spec.section || ''],
    ['SUBJECT', spec.subject || ''],
    ['TEACHER', spec.teacher || ''],
    ['SCHOOL YEAR', spec.schoolYear || ''],
    ['WEIGHTS', `WW ${Math.round(weights.ww * 100)}% · PT ${Math.round(weights.pt * 100)}% · EX ${weights.ex === null ? '—' : `${Math.round(weights.ex * 100)}%`}`],
  ];
  info.forEach(([label, value], i) => {
    const row = 10 + i;
    put(ws, `C${row}`, label, { font: { bold: true }, fill: COLOURS.componentHeader, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }, border: { top: thin, bottom: thin, left: thin, right: thin } });
    put(ws, `E${row}`, value, { alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }, border: { bottom: thin } });
  });

  // The learner lists, on the right — the cells the parser reads.
  ws.mergeCells('M8:S8');
  put(ws, 'M8', "LEARNERS' NAMES", { font: { bold: true, size: 12, color: { argb: COLOURS.white } }, fill: COLOURS.namesBar });
  for (const block of LAYOUT.blocks) {
    const numberCol = columnLetters(columnNumber(block.lrnColumn) - 1);
    const isMale = block.gender === 'male';
    const tint = isMale ? COLOURS.maleNumber : COLOURS.femaleNumber;
    const headerBorder = { top: medium, bottom: medium, left: thin, right: thin };
    put(ws, `${numberCol}10`, 'No.', { font: { bold: true }, fill: tint, border: headerBorder });
    put(ws, `${block.lrnColumn}10`, 'LRN', { font: { bold: true }, fill: COLOURS.componentHeader, border: headerBorder });
    put(ws, `${block.nameColumn}10`, isMale ? 'MALE  (Last name, First name)' : 'FEMALE  (Last name, First name)', {
      font: { bold: true, color: { argb: COLOURS.white } },
      fill: COLOURS.genderBar,
      border: headerBorder,
    });
    const capacity = block.lastRow - block.firstRow + 1;
    for (let k = 0; k < capacity; k += 1) {
      const row = LAYOUT.inputDataFirstRow + k;
      const learner = slots[block.gender][k];
      const border = { top: thin, bottom: thin, left: thin, right: thin };
      put(ws, `${numberCol}${row}`, k + 1, { font: { bold: true }, fill: tint, border });
      // LRNs are text: twelve digits would otherwise display as 1.0E+11 and
      // lose any leading zero.
      put(ws, `${block.lrnColumn}${row}`, learner ? String(learner.lrn) : null, { numFmt: '@', border });
      put(ws, `${block.nameColumn}${row}`, learner ? learner.name : null, { alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }, border });
    }
  }
  return ws;
}

function buildTermSheet(wb, spec, term, slots, weights) {
  const ws = wb.addWorksheet(`Term ${term.sequence}`, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 15, topLeftCell: 'D16', showGridLines: false, zoomScale: 85 }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '11:15',
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  for (const col of columnsBetween('A', 'AN')) ws.getColumn(col).width = COLUMN_WIDTHS[col] || NARROW;
  const hpsRow = LAYOUT.hpsRow;
  const hasExam = weights.ex !== null;
  const termExamOnly = TERM_EXAM_ONLY_GROUPS.has(spec.weightGroup);
  const ordinal = ['', 'FIRST', 'SECOND', 'THIRD'][term.sequence] || `TERM ${term.sequence}`;

  // Title block (rows 2–3).
  ws.mergeCells('B2:AM2');
  put(ws, 'B2', 'Senior High School Class Record', { font: { size: 22, bold: true } });
  ws.getRow(2).height = 28.2;
  ws.mergeCells('B3:AM3');
  put(ws, 'B3', '(Pursuant to DepEd Order No. 015, s. 2026)', { font: { size: 10, italic: true } });
  // The school, where DepEd's sheet has its SCHOOL NAME block (rows 5–6).
  // Rows the sheet does not use are kept short so the record starts near
  // the title instead of under a band of empty rows.
  if (spec.school && spec.school.name) {
    ws.mergeCells('B5:AM5');
    put(ws, 'B5', spec.school.name.toUpperCase(), { font: { size: 12, bold: true } });
    ws.mergeCells('B6:AM6');
    put(ws, 'B6', spec.school.address || '', { font: { size: 10, color: { argb: 'FF595959' } } });
    for (const row of [4, 7, 8]) ws.getRow(row).height = 6;
  } else {
    for (const row of [4, 5, 6, 7, 8]) ws.getRow(row).height = 6;
  }

  // Class block (rows 9–10). N9, U9 and H10 are read by the parser.
  const label = { font: { size: 10 }, alignment: { horizontal: 'right', vertical: 'middle' } };
  const valueStyle = { font: { size: 11, bold: true }, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }, border: { bottom: thin } };
  ws.mergeCells('D9:G9'); put(ws, 'D9', 'GRADE LEVEL', label);
  ws.mergeCells('H9:I9'); put(ws, 'H9', spec.gradeLevel ? String(spec.gradeLevel) : '', valueStyle);
  ws.mergeCells('J9:M9'); put(ws, 'J9', 'SECTION', label);
  ws.mergeCells('N9:P9'); put(ws, LAYOUT.sectionCell, spec.section || '', valueStyle);
  ws.mergeCells('Q9:T9'); put(ws, 'Q9', 'SUBJECT', { ...label, font: { size: 10, bold: true, color: { argb: COLOURS.subjectText } } });
  ws.mergeCells('U9:AM9');
  put(ws, LAYOUT.subjectCell, spec.subject || '', { ...valueStyle, font: { size: 14, bold: true, color: { argb: COLOURS.subjectText } } });
  ws.getRow(9).height = 20.4;
  ws.mergeCells('D10:G10'); put(ws, 'D10', 'TEACHER', label);
  ws.mergeCells('H10:P10'); put(ws, LAYOUT.teacherCell, spec.teacher || '', valueStyle);
  ws.mergeCells('Q10:T10'); put(ws, 'Q10', 'SCHOOL YEAR', label);
  ws.mergeCells('U10:AM10'); put(ws, 'U10', spec.schoolYear || '', valueStyle);
  ws.getRow(10).height = 16.5;

  // The term label (B9:C13 in DepEd's sheet; here B11:C13, under the class
  // block so the two never overlap).
  ws.mergeCells('B11:C13');
  put(ws, 'B11', `${ordinal} TERM`, { font: { size: 20, bold: true }, border: { top: medium, left: medium, bottom: thin, right: medium } });

  // Component bands (row 11), weights (row 12), item numbers (row 13).
  const band = { font: { size: 11, bold: true }, fill: COLOURS.componentHeader };
  ws.mergeCells('D11:P11'); put(ws, 'D11', 'WRITTEN / ORAL WORKS (WWs)', band);
  ws.mergeCells('Q11:AC11'); put(ws, 'Q11', 'PRODUCT / PERFORMANCE TASKS (PTs)', band);
  ws.mergeCells('AD11:AK11'); put(ws, 'AD11', 'EXAMINATIONS (EXs)', hasExam ? band : { ...band, fill: COLOURS.notGraded });
  ws.mergeCells('D12:P12'); put(ws, 'D12', weights.ww, { ...band, numFmt: '0%' });
  ws.mergeCells('Q12:AC12'); put(ws, 'Q12', weights.pt, { ...band, numFmt: '0%' });
  ws.mergeCells('AD12:AK12');
  put(ws, 'AD12', hasExam ? weights.ex : 'Not graded in this subject', hasExam ? { ...band, numFmt: '0%' } : { ...band, fill: COLOURS.notGraded, font: { size: 9, italic: true } });
  ws.getRow(11).height = 20.4;
  ws.getRow(12).height = 21;
  ws.mergeCells(`${COMPUTED.initialGrade}11:${COMPUTED.initialGrade}14`);
  put(ws, `${COMPUTED.initialGrade}11`, 'INITIAL GRADE', { font: { bold: true, size: 9 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
  ws.mergeCells(`${COMPUTED.termGrade}11:${COMPUTED.termGrade}14`);
  put(ws, `${COMPUTED.termGrade}11`, 'TERM GRADE', { font: { bold: true, size: 9 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });

  for (const column of ITEM_COLUMNS) {
    if (column.component === 'ex') continue;
    put(ws, `${column.col}13`, Number(column.key.replace(/\D/g, '')), { font: { bold: true }, fill: COLOURS.itemNumber });
  }
  for (const key of ['ww', 'pt']) {
    const c = COMPUTED[key];
    put(ws, `${c.total}13`, 'TOTAL', { font: { bold: true }, fill: COLOURS.computed });
    put(ws, `${c.ps}13`, 'PS', { font: { bold: true }, fill: COLOURS.computed });
    put(ws, `${c.ws}13`, 'WS', { font: { bold: true }, fill: COLOURS.computed });
  }
  const examPartUsed = (part) => hasExam && (!termExamOnly || part.key === 'te');
  for (const part of COMPUTED.ex.parts) {
    const used = examPartUsed(part);
    put(ws, `${part.input}13`, part.label, { font: { bold: true }, fill: used ? COLOURS.itemNumber : COLOURS.notGraded });
    put(ws, `${part.weighted}13`, part.weightedLabel, { font: { bold: true, size: 8 }, fill: used ? COLOURS.computed : COLOURS.notGraded });
  }
  put(ws, `${COMPUTED.ex.ps}13`, 'PS', { font: { bold: true }, fill: hasExam ? COLOURS.computed : COLOURS.notGraded });
  put(ws, `${COMPUTED.ex.ws}13`, 'WS', { font: { bold: true }, fill: hasExam ? COLOURS.computed : COLOURS.notGraded });

  // Row 14: HIGHEST POSSIBLE SCORE — the parser reads the item cells.
  ws.mergeCells(`B${hpsRow}:C${hpsRow}`);
  put(ws, `B${hpsRow}`, 'HIGHEST POSSIBLE SCORE', { font: { bold: true }, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 } });
  for (const column of ITEM_COLUMNS) {
    const value = (term.hps || {})[column.key];
    const used = column.component !== 'ex' || examPartUsed(COMPUTED.ex.parts.find((p) => p.key === column.examPart));
    put(ws, `${column.col}${hpsRow}`, value !== undefined ? value : null, { font: { bold: true }, fill: used ? undefined : COLOURS.notGraded });
  }
  for (const key of ['ww', 'pt']) {
    const c = COMPUTED[key];
    put(ws, `${c.total}${hpsRow}`, { formula: `IF(COUNT(${c.first}${hpsRow}:${c.last}${hpsRow})=0,"",SUM(${c.first}${hpsRow}:${c.last}${hpsRow}))` }, { fill: COLOURS.computed });
    put(ws, `${c.ps}${hpsRow}`, 100, { fill: COLOURS.computed });
    put(ws, `${c.ws}${hpsRow}`, weights[key], { fill: COLOURS.computed, numFmt: '0%', font: { bold: true } });
  }
  for (const part of COMPUTED.ex.parts) {
    const partWeight = !examPartUsed(part) ? null : termExamOnly ? 1 : EXAM_PARTS[part.key].weight;
    put(ws, `${part.weighted}${hpsRow}`, partWeight, { fill: partWeight === null ? COLOURS.notGraded : COLOURS.computed, numFmt: '0%' });
  }
  put(ws, `${COMPUTED.ex.ps}${hpsRow}`, hasExam ? 100 : null, { fill: hasExam ? COLOURS.computed : COLOURS.notGraded });
  put(ws, `${COMPUTED.ex.ws}${hpsRow}`, hasExam ? weights.ex : null, { fill: hasExam ? COLOURS.computed : COLOURS.notGraded, numFmt: '0%', font: { bold: true } });

  // Row 15: LEARNERS' NAMES bar; rows 16 and 67: MALE / FEMALE.
  ws.mergeCells('B15:AM15');
  put(ws, 'B15', "LEARNERS' NAMES", { font: { size: 14, bold: true, color: { argb: COLOURS.white } }, fill: COLOURS.namesBar, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 } });
  ws.getRow(15).height = 18;
  for (const block of LAYOUT.blocks) {
    const barRow = block.firstRow - 1;
    ws.mergeCells(`B${barRow}:AM${barRow}`);
    put(ws, `B${barRow}`, block.gender === 'male' ? 'MALE' : 'FEMALE', {
      font: { bold: true, color: { argb: COLOURS.white } },
      fill: COLOURS.genderBar,
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
    });
  }

  // Header grid lines.
  const gridColumns = columnsBetween('D', 'AM');
  const groupStarts = new Set(['D', 'Q', 'AD', 'AG', 'AJ', COMPUTED.initialGrade]);
  grid(ws, 11, hpsRow, gridColumns, groupStarts);

  // Learner rows.
  const weightedParts = COMPUTED.ex.parts.filter(examPartUsed);
  for (const block of LAYOUT.blocks) {
    const inputColumn = block.nameColumn; // INPUT DATA column with this block's names
    const tint = block.gender === 'male' ? COLOURS.maleNumber : COLOURS.femaleNumber;
    const capacity = block.lastRow - block.firstRow + 1;
    grid(ws, block.firstRow, block.lastRow, ['B', 'C', ...gridColumns], new Set(['B', 'C', ...groupStarts]));
    for (let k = 0; k < capacity; k += 1) {
      const row = block.firstRow + k;
      const learner = slots[block.gender][k];
      const inputRow = LAYOUT.inputDataFirstRow + k;
      put(ws, `B${row}`, k + 1, { font: { bold: true }, fill: tint, border: ws.getCell(`B${row}`).border });
      // The name is read from INPUT DATA, so a learner added there appears
      // on every term. The cached result is the name itself, so the import
      // reads it whether or not the file has been opened in Excel.
      const ref = `'INPUT DATA'!${inputColumn}${inputRow}`;
      put(ws, `C${row}`, { formula: `IF(${ref}="","",${ref})`, result: learner ? learner.name : '' }, {
        alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
        border: ws.getCell(`C${row}`).border,
      });

      const scores = learner ? (term.scores || {})[learner.lrn] || {} : {};
      for (const column of ITEM_COLUMNS) {
        if (scores[column.key] !== undefined) ws.getCell(`${column.col}${row}`).value = scores[column.key];
        ws.getCell(`${column.col}${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
      }

      const computedStyle = (col, bold = false) => {
        const cell = ws.getCell(`${col}${row}`);
        cell.fill = fill(COLOURS.computed);
        cell.numFmt = '0.00';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: FONT, size: 10, bold };
      };
      for (const key of ['ww', 'pt']) {
        const c = COMPUTED[key];
        ws.getCell(`${c.total}${row}`).value = { formula: componentTotalFormula(c, row) };
        ws.getCell(`${c.ps}${row}`).value = { formula: percentageFormula(c.total, row) };
        ws.getCell(`${c.ws}${row}`).value = { formula: `IF(${c.ps}${row}="","",ROUND(${c.ps}${row}*$${c.ws}$${hpsRow},2))` };
        computedStyle(c.total);
        ws.getCell(`${c.total}${row}`).numFmt = 'General';
        computedStyle(c.ps);
        computedStyle(c.ws, true);
      }

      const gradeParts = [`${COMPUTED.ww.ws}${row}`, `${COMPUTED.pt.ws}${row}`];
      if (hasExam) {
        // Each exam part: PS of that part (raw ÷ HPS × 100, rounded) × the
        // part's weight, rounded — gradeCalculator's two steps.
        for (const part of COMPUTED.ex.parts) {
          const cell = ws.getCell(`${part.weighted}${row}`);
          if (examPartUsed(part)) {
            const hps = `$${part.input}$${hpsRow}`;
            cell.value = {
              formula: `IFERROR(IF(OR($C${row}="",${hps}="",${part.input}${row}=""),"",ROUND(ROUND(${part.input}${row}/${hps}*100,2)*$${part.weighted}$${hpsRow},2)),"")`,
            };
            computedStyle(part.weighted);
          } else {
            cell.fill = fill(COLOURS.notGraded);
            ws.getCell(`${part.input}${row}`).fill = fill(COLOURS.notGraded);
          }
        }
        const required = weightedParts.map((p) => `${p.weighted}${row}=""`).join(',');
        const sum = weightedParts.map((p) => `${p.weighted}${row}`).join('+');
        ws.getCell(`${COMPUTED.ex.ps}${row}`).value = { formula: `IF(OR(${required}),"",ROUND(${sum},2))` };
        ws.getCell(`${COMPUTED.ex.ws}${row}`).value = { formula: `IF(${COMPUTED.ex.ps}${row}="","",ROUND(${COMPUTED.ex.ps}${row}*$${COMPUTED.ex.ws}$${hpsRow},2))` };
        computedStyle(COMPUTED.ex.ps);
        computedStyle(COMPUTED.ex.ws, true);
        gradeParts.push(`${COMPUTED.ex.ws}${row}`);
      } else {
        for (const col of columnsBetween('AD', 'AK')) ws.getCell(`${col}${row}`).fill = fill(COLOURS.notGraded);
      }

      const ig = `${COMPUTED.initialGrade}${row}`;
      ws.getCell(ig).value = {
        formula: `IF(OR(${gradeParts.map((a) => `${a}=""`).join(',')}),"",ROUND(${gradeParts.join('+')},2))`,
      };
      ws.getCell(ig).numFmt = '0.00';
      ws.getCell(ig).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(ig).font = { name: FONT, size: 10 };

      const tg = ws.getCell(`${COMPUTED.termGrade}${row}`);
      const given = learner ? (term.termGrades || {})[learner.lrn] : undefined;
      const termGradeFormula = GRADING_MODE === 'zero_based'
        ? `IF(${ig}="","",MAX(${MINIMUM_REPORTABLE_GRADE},ROUND(${ig},0)))`
        : `IF(${ig}="","",VLOOKUP(${ig},HELPER!$A$${HELPER_FIRST_ROW}:$B$${HELPER_LAST_ROW},2,1))`;
      // When the caller already knows the grade (the demo sample, and the
      // tests' fixtures), it is stored as the formula's cached result — what
      // a workbook saved in Excel carries — so the import's cross-check
      // reads it before the file is ever opened. Excel recomputes on open.
      tg.value = given !== undefined ? { formula: termGradeFormula, result: given } : { formula: termGradeFormula };
      tg.alignment = { horizontal: 'center', vertical: 'middle' };
      tg.font = { name: FONT, size: 11, bold: true };
    }
  }

  // Scores accept only a number from 0 to that activity's highest possible
  // score. One rule per column, covering both learner blocks.
  const firstLearnerRow = LAYOUT.blocks[0].firstRow;
  const lastLearnerRow = LAYOUT.blocks[LAYOUT.blocks.length - 1].lastRow;
  for (const column of ITEM_COLUMNS) {
    if (column.component === 'ex' && !examPartUsed(COMPUTED.ex.parts.find((p) => p.key === column.examPart))) continue;
    ws.dataValidations.add(`${column.col}${firstLearnerRow}:${column.col}${lastLearnerRow}`, {
      type: 'decimal',
      operator: 'between',
      allowBlank: true,
      formulae: [0, `$${column.col}$${hpsRow}`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Score out of range',
      error: `A score must be a number from 0 to this activity's highest possible score (row ${hpsRow}). Leave it blank if there is no score yet.`,
    });
  }

  // A Term Grade below passing is shaded red — an empty grade is not.
  const tgRange = `${COMPUTED.termGrade}${firstLearnerRow}:${COMPUTED.termGrade}${lastLearnerRow}`;
  ws.addConditionalFormatting({
    ref: tgRange,
    rules: [{
      type: 'expression',
      priority: 1,
      formulae: [`AND(ISNUMBER(${COMPUTED.termGrade}${firstLearnerRow}),${COMPUTED.termGrade}${firstLearnerRow}<${PASSING_GRADE})`],
      style: {
        font: { color: { argb: COLOURS.belowPassingText }, bold: true },
        fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLOURS.belowPassingFill } },
      },
    }],
  });
  return ws;
}

function buildFinalGrades(wb, spec, slots, termSequences) {
  const ws = wb.addWorksheet('FINAL GRADES', { views: [{ showGridLines: false, state: 'frozen', ySplit: 7 }] });
  const termColumns = termSequences.map((sequence, i) => ({ sequence, col: columnLetters(4 + i) })); // D, E, F
  const averageCol = columnLetters(4 + termColumns.length);
  ws.getColumn('A').width = 2;
  ws.getColumn('B').width = 5;
  ws.getColumn('C').width = 38;
  for (const t of termColumns) ws.getColumn(t.col).width = 11;
  ws.getColumn(averageCol).width = 14;

  ws.mergeCells(`B2:${averageCol}2`);
  put(ws, 'B2', 'Summary of Term Grades', { font: { size: 18, bold: true } });
  ws.mergeCells(`B3:${averageCol}3`);
  put(ws, 'B3', `${spec.subject || ''}${spec.section ? ` — ${spec.section}` : ''}`, { font: { size: 12, bold: true, color: { argb: COLOURS.subjectText } } });
  ws.mergeCells(`B4:${averageCol}4`);
  put(ws, 'B4', 'Filled in from each Term sheet. The official grade is the one finalized in the Student Portal.', { font: { italic: true, color: { argb: 'FF595959' } } });

  const headerBorder = { top: medium, bottom: medium, left: thin, right: thin };
  put(ws, 'B7', 'No.', { font: { bold: true }, fill: COLOURS.componentHeader, border: headerBorder });
  put(ws, 'C7', "LEARNER'S NAME", { font: { bold: true }, fill: COLOURS.componentHeader, border: headerBorder });
  for (const t of termColumns) put(ws, `${t.col}7`, `TERM ${t.sequence}`, { font: { bold: true }, fill: COLOURS.itemNumber, border: headerBorder });
  put(ws, `${averageCol}7`, 'AVERAGE\n(terms so far)', { font: { bold: true, size: 9 }, fill: COLOURS.computed, border: headerBorder, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
  ws.getRow(7).height = 28;

  let row = 8;
  for (const block of LAYOUT.blocks) {
    ws.mergeCells(`B${row}:${averageCol}${row}`);
    put(ws, `B${row}`, block.gender === 'male' ? 'MALE' : 'FEMALE', { font: { bold: true, color: { argb: COLOURS.white } }, fill: COLOURS.genderBar, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 } });
    row += 1;
    const tint = block.gender === 'male' ? COLOURS.maleNumber : COLOURS.femaleNumber;
    // Only the listed learners, so the summary is not 100 empty rows.
    slots[block.gender].forEach((learner, k) => {
      const border = { top: thin, bottom: thin, left: thin, right: thin };
      const termRow = block.firstRow + k;
      const inputRow = LAYOUT.inputDataFirstRow + k;
      put(ws, `B${row}`, k + 1, { font: { bold: true }, fill: tint, border });
      const ref = `'INPUT DATA'!${block.nameColumn}${inputRow}`;
      put(ws, `C${row}`, { formula: `IF(${ref}="","",${ref})`, result: learner.name }, { alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }, border });
      for (const t of termColumns) {
        const source = `'Term ${t.sequence}'!${COMPUTED.termGrade}${termRow}`;
        put(ws, `${t.col}${row}`, { formula: `IF(${source}="","",${source})` }, { border });
      }
      const range = `${termColumns[0].col}${row}:${termColumns[termColumns.length - 1].col}${row}`;
      put(ws, `${averageCol}${row}`, { formula: `IF(COUNT(${range})=0,"",ROUND(AVERAGE(${range}),2))` }, { fill: COLOURS.computed, numFmt: '0.00', font: { bold: true }, border });
      row += 1;
    });
  }
  const lastRow = row - 1;
  if (lastRow >= 9) {
    ws.addConditionalFormatting({
      ref: `D9:${averageCol}${lastRow}`,
      rules: [{
        type: 'expression',
        priority: 1,
        formulae: [`AND(ISNUMBER(D9),D9<${PASSING_GRADE})`],
        style: { font: { color: { argb: COLOURS.belowPassingText }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLOURS.belowPassingFill } } },
      }],
    });
  }
}

function buildHelper(wb) {
  const ws = wb.addWorksheet('HELPER', { state: 'hidden' });
  ws.getCell('A1').value = 'INITIAL GRADE (minimum)';
  ws.getCell('B1').value = 'TERM GRADE';
  const ascending = [...TRANSMUTATION_TABLE].sort((a, b) => a[0] - b[0]);
  ascending.forEach(([minimum, transmuted], i) => {
    ws.getCell(`A${HELPER_FIRST_ROW + i}`).value = minimum;
    ws.getCell(`B${HELPER_FIRST_ROW + i}`).value = transmuted;
  });
}

// spec = {
//   section, subject, teacher, schoolYear?, gradeLevel?, school?: { name, address },
//   weightGroup?   — the subject's DepEd weight group (defaults to core)
//   learners: [{ lrn, name, gender: 'male'|'female' }],
//   terms: [{ sequence, hps: { ww1: 20, pt1: 25, st1: 20, ... },
//             scores: { [lrn]: { ww1: 17, ... } }, termGrades?: { [lrn]: 88 } }]
// }
async function buildEclassWorkbook(spec) {
  const weightGroup = WEIGHT_GROUPS[spec.weightGroup] ? spec.weightGroup : DEFAULT_WEIGHT_GROUP;
  const fullSpec = { ...spec, weightGroup };
  const weights = WEIGHT_GROUPS[weightGroup];

  const slots = { male: [], female: [] };
  for (const learner of spec.learners) slots[learner.gender].push(learner);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Student Portal';
  wb.created = new Date();
  // The formulas have no cached results yet; make Excel compute them all
  // the moment the file is opened.
  wb.calcProperties.fullCalcOnLoad = true;

  buildInstructions(wb, fullSpec, weights);
  buildInputData(wb, fullSpec, slots, weights);
  const terms = [...spec.terms].sort((a, b) => a.sequence - b.sequence);
  for (const term of terms) buildTermSheet(wb, fullSpec, term, slots, weights);
  buildFinalGrades(wb, fullSpec, slots, terms.map((t) => t.sequence));
  buildHelper(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { buildEclassWorkbook };
