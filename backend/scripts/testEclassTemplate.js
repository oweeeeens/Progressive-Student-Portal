// Checks the downloadable e-Class Record template (scripts/lib/eclassWorkbook.js)
// with no database: that it still imports, and that its live formulas are
// wired to DepEd's numbers for each weight group.
//
// What this cannot do is run Excel. The formulas' arithmetic was verified
// when they were written by opening a filled template in Excel 2013 (12 of
// 12 Term Grades equal to services/gradeCalculator.js, DepEd's Table 5
// example giving 88) and with a formula engine across every weight group
// (280 learners). These checks keep the structure that made that true.
// Run with: node scripts/testEclassTemplate.js
const ExcelJS = require('exceljs');
const { buildEclassWorkbook } = require('./lib/eclassWorkbook');
const { parseEclassRecord, LAYOUT } = require('../services/eclassRecordParser');
const { WEIGHT_GROUPS, TRANSMUTATION_TABLE, TERM_EXAM_ONLY_GROUPS } = require('../config/gradingPolicy');

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, description) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  PASS: ${description}`);
  } else {
    failed += 1;
    console.log(`  FAIL: ${description}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
  }
}

const learners = [
  { lrn: '012345678901', name: 'Marquez, Hector', gender: 'male' },
  { lrn: '108000000101', name: 'Garcia, Eve', gender: 'female' },
];
const table5 = { ww1: 20, ww2: 25, ww3: 20, ww4: 20, pt1: 25, pt2: 25, st1: 20, st2: 20, te: 40 };

async function build(weightGroup, terms) {
  const buffer = await buildEclassWorkbook({ section: 'Grade 11 - ABM A', subject: 'Business Mathematics', teacher: '', weightGroup, learners, terms });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return { buffer, wb };
}
const formulaOf = (cell) => (cell.value && typeof cell.value === 'object' ? cell.value.formula || null : null);

(async () => {
  console.log('A blank template is recognised as an e-Class Record');
  {
    const { buffer, wb } = await build('core', [1, 2, 3].map((sequence) => ({ sequence, hps: {}, scores: {} })));
    const message = await parseEclassRecord(buffer).then(() => null, (err) => err.message);
    assertEqual(message, 'No term in this workbook has highest possible scores filled in yet, so there is nothing to import.', 'not filled in yet: refused with that reason, not as "not an e-Class Record"');
    assertEqual(wb.worksheets.map((w) => w.name), ['INSTRUCTIONS', 'INPUT DATA', 'Term 1', 'Term 2', 'Term 3', 'FINAL GRADES', 'HELPER'], "DepEd's sheets, in DepEd's order");
    assertEqual(wb.getWorksheet('HELPER').state, 'hidden', 'the transmutation table sheet is hidden');
    // exceljs writes these but does not read them back, so the file's XML is
    // checked directly (jszip is the zip library exceljs itself uses).
    const zip = await require('jszip').loadAsync(buffer);
    const workbookXml = await zip.file('xl/workbook.xml').async('string');
    assertEqual(/<calcPr[^>]*fullCalcOnLoad="1"/.test(workbookXml), true, 'Excel recomputes every formula when the file is opened');
    const term1Xml = await zip.file('xl/worksheets/sheet3.xml').async('string');
    assertEqual((term1Xml.match(/<dataValidation /g) || []).length, 23, 'every score column (10 WW, 10 PT, 3 exams) is validated');
    assertEqual(/sqref="D17:D117"><formula1>0<\/formula1><formula2>\$D\$14<\/formula2>/.test(term1Xml), true, 'a score must be 0 to its highest possible score');
    const input = wb.getWorksheet('INPUT DATA');
    assertEqual(input.getCell(`N${LAYOUT.inputDataFirstRow}`).value, '012345678901', 'an LRN keeps its leading zero');
    assertEqual(input.getCell(`N${LAYOUT.inputDataFirstRow}`).numFmt, '@', 'LRN cells are text, never 1.0E+11');
  }

  console.log('A filled template imports exactly as before');
  {
    const scores = { '012345678901': { ww1: 17, ww2: 22, ww3: 20, ww4: 15, pt1: 20, pt2: 23, st1: 15, st2: 18, te: 35 } };
    const { buffer, wb } = await build('core', [{ sequence: 1, hps: table5, scores, termGrades: { '012345678901': 88 } }]);
    const term = (await parseEclassRecord(buffer)).terms[0];
    assertEqual(term.items.length, 9, 'every item with a highest possible score');
    assertEqual(term.learners.map((l) => [l.name, l.lrn]), [['Marquez, Hector', '012345678901'], ['Garcia, Eve', '108000000101']], 'names (formula results) and LRNs read back');
    assertEqual(term.learners[0].scores, scores['012345678901'], 'scores read back unchanged');
    assertEqual(term.learners[0].sheetTermGrade, 88, 'a known grade is the cached result, so the cross-check has it');
    const ws = wb.getWorksheet('Term 1');
    assertEqual(formulaOf(ws.getCell('C17')), "IF('INPUT DATA'!O11=\"\",\"\",'INPUT DATA'!O11)", 'names come from INPUT DATA');
    assertEqual(/VLOOKUP\(AL17,HELPER!\$A\$2:\$B\$42,2,1\)/.test(formulaOf(ws.getCell('AM17'))), true, 'the Term Grade is looked up in the HELPER table');
  }

  console.log('The transmutation table matches config/gradingPolicy.js');
  {
    const { wb } = await build('core', [{ sequence: 1, hps: {}, scores: {} }]);
    const helper = wb.getWorksheet('HELPER');
    const rows = [];
    for (let r = 2; r < 2 + TRANSMUTATION_TABLE.length; r += 1) rows.push([helper.getCell(`A${r}`).value, helper.getCell(`B${r}`).value]);
    assertEqual(rows, [...TRANSMUTATION_TABLE].sort((a, b) => a[0] - b[0]), 'every row, ascending (what an approximate VLOOKUP needs)');
  }

  console.log('Each weight group gets its own DepEd weights');
  for (const [group, weights] of Object.entries(WEIGHT_GROUPS)) {
    const { wb } = await build(group, [{ sequence: 1, hps: {}, scores: {} }]);
    const ws = wb.getWorksheet('Term 1');
    const al = formulaOf(ws.getCell('AL17'));
    assertEqual([ws.getCell('P14').value, ws.getCell('AC14').value], [weights.ww, weights.pt], `${group}: WW and PT weights`);
    if (weights.ex === null) {
      assertEqual([ws.getCell('AK14').value, al.includes('AK17')], [null, false], `${group}: no examinations, and the Initial Grade leaves them out`);
    } else if (TERM_EXAM_ONLY_GROUPS.has(group)) {
      assertEqual([ws.getCell('AG14').value, ws.getCell('AH14').value, ws.getCell('AI14').value, ws.getCell('AK14').value], [null, null, 1, weights.ex], `${group}: Term Examination only, at 100% of the exam`);
    } else {
      assertEqual([ws.getCell('AG14').value, ws.getCell('AH14').value, ws.getCell('AI14').value, ws.getCell('AK14').value], [0.3, 0.3, 0.4, weights.ex], `${group}: ST1 30%, ST2 30%, TE 40%`);
    }
  }

  console.log('Excel 2013 compatible, and guarded');
  {
    const { wb } = await build('core', [{ sequence: 1, hps: table5, scores: {} }]);
    const formulas = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { const f = formulaOf(cell); if (f) formulas.push(f); })));
    assertEqual(formulas.filter((f) => /XLOOKUP|\bIFS\(|_xlfn|FILTER\(|LET\(/.test(f)), [], 'no function newer than Excel 2013');
    const ws = wb.getWorksheet('Term 1');
    assertEqual(/<COUNT\(\$D\$14:\$M\$14\)/.test(formulaOf(ws.getCell('N17'))), true, 'a component stays blank until every score is in (a blank is not a zero)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
