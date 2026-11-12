// Builds a workbook in DepEd's e-Class Record layout (see
// services/eclassRecordParser.js for the cell map), for the integration
// tests and for the demo sample file (scripts/makeSampleEclassRecord.js).
// Values only — no formulas: the importer reads cached values, which is
// exactly what a saved ECR gives it.
const ExcelJS = require('exceljs');
const { LAYOUT, ITEM_COLUMNS } = require('../../services/eclassRecordParser');

// spec = {
//   section, subject, teacher,
//   learners: [{ lrn, name, gender: 'male'|'female' }],
//   terms: [{ sequence, hps: { ww1: 20, pt1: 25, st1: 20, ... },
//             scores: { [lrn]: { ww1: 17, ... } }, termGrades: { [lrn]: 88 } }]
// }
async function buildEclassWorkbook(spec) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('INSTRUCTIONS').getCell('B2').value = 'Electronic Class Record';
  const input = wb.addWorksheet('INPUT DATA');
  input.getCell('D2').value = 'Input Data Sheet for Electronic Class Record (ECR)';
  const slots = { male: [], female: [] };
  for (const learner of spec.learners) slots[learner.gender].push(learner);
  for (const block of LAYOUT.blocks) {
    slots[block.gender].forEach((learner, index) => {
      const row = LAYOUT.inputDataFirstRow + index;
      input.getCell(`${block.lrnColumn}${row}`).value = learner.lrn;
      input.getCell(`${block.nameColumn}${row}`).value = learner.name;
    });
  }
  for (const term of spec.terms) {
    const ws = wb.addWorksheet(`Term ${term.sequence}`);
    ws.getCell('B2').value = 'Senior High School Class Record';
    ws.getCell(LAYOUT.sectionCell).value = spec.section;
    ws.getCell(LAYOUT.subjectCell).value = spec.subject;
    ws.getCell(LAYOUT.teacherCell).value = spec.teacher;
    ws.getCell(`B${LAYOUT.hpsRow}`).value = 'HIGHEST POSSIBLE SCORE';
    // Readable headers, as in DepEd's own workbook: the component names on
    // row 11 and the item numbers on row 13. The importer does not read them.
    ws.getCell('D11').value = 'WRITTEN / ORAL WORKS (WWs)';
    ws.getCell('Q11').value = 'PRODUCT / PERFORMANCE TASKS (PTs)';
    ws.getCell('AD11').value = 'EXAMINATIONS (EXs)';
    ws.getCell('AL11').value = 'INITIAL GRADE';
    ws.getCell('AM11').value = 'TERM GRADE';
    for (const column of ITEM_COLUMNS) {
      ws.getCell(`${column.col}13`).value = column.component === 'ex' ? column.examPart.toUpperCase().replace('ST', 'ST ') : Number(column.key.replace(/\D/g, ''));
    }
    ws.getCell('B15').value = "LEARNERS' NAMES";
    ws.getCell(`B${LAYOUT.blocks[0].firstRow - 1}`).value = 'MALE';
    ws.getCell(`B${LAYOUT.blocks[1].firstRow - 1}`).value = 'FEMALE';
    ws.getCell('J9').value = 'SECTION';
    ws.getCell('Q9').value = 'SUBJECT';
    ws.getCell('D10').value = 'TEACHER';
    for (const column of ITEM_COLUMNS) {
      if ((term.hps || {})[column.key] !== undefined) ws.getCell(`${column.col}${LAYOUT.hpsRow}`).value = term.hps[column.key];
    }
    for (const block of LAYOUT.blocks) {
      slots[block.gender].forEach((learner, index) => {
        const row = block.firstRow + index;
        ws.getCell(`${LAYOUT.nameColumn}${row}`).value = learner.name;
        const scores = (term.scores || {})[learner.lrn] || {};
        for (const column of ITEM_COLUMNS) {
          if (scores[column.key] !== undefined) ws.getCell(`${column.col}${row}`).value = scores[column.key];
        }
        const grade = (term.termGrades || {})[learner.lrn];
        if (grade !== undefined) ws.getCell(`${LAYOUT.termGradeColumn}${row}`).value = grade;
      });
    }
  }
  wb.addWorksheet('FINAL GRADES');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { buildEclassWorkbook };
