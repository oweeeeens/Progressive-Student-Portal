// Structure check for the SF2 template (services/sf2Template.js): the file is
// DepEd's official School Form 2, filled in — and it stays the official form
// when a section has more learners than the form's 21 male / 25 female rows.
// Run: node scripts/testSf2Template.js
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { buildSf2Template, schoolDaysOfMonth, TEMPLATE_PATH } = require('../services/sf2Template');

// The bundled workbook must be DepEd's file, byte for byte (see
// backend/templates/README.md for the source).
const OFFICIAL_SHA256 = '710676199e88e9b811c2';

let passed = 0;
function check(name, fn) {
  return Promise.resolve(fn()).then(() => { passed += 1; console.log(`  ok  ${name}`); });
}
async function load(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}
const learners = (n, sex, last) => Array.from({ length: n }, (_, i) => ({ name: `${last}${String.fromCharCode(65 + (i % 26))}, Juan`, sex }));

(async () => {
  console.log('SF2 template');
  await check('the bundled workbook is DepEd\'s official file, unmodified', () => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(TEMPLATE_PATH)).digest('hex');
    assert.ok(hash.startsWith(OFFICIAL_SHA256), hash);
  });

  const base = { schoolName: 'DepEd Progressive Senior High School - Bacoor City', schoolYear: '2026-2027', gradeLevel: 11, sectionName: 'STEM A' };
  const small = await load(await buildSf2Template({ ...base, month: 11, year: 2026, learners: [...learners(3, 'M', 'Garcia'), ...learners(2, 'F', 'Santos')] }));
  const ws = small.worksheets[0];

  await check('only the SF2 sheet is left, with DepEd\'s title and labels', () => {
    assert.equal(small.worksheets.length, 1);
    assert.equal(ws.name, 'School Form 2 (SF2)');
    assert.equal(ws.getCell('A2').value, 'School Form 2 (SF2) Daily Attendance Report of Learners');
    assert.equal(ws.getCell('B6').value, 'School ID');
    assert.match(String(ws.getCell('A10').value), /LEARNER'S NAME/);
    assert.match(String(ws.getCell('D10').value), /1st row for date, 2nd row for Day/);
  });
  await check('the header is filled in', () => {
    assert.equal(ws.getCell('K6').value, '2026-2027');
    assert.equal(ws.getCell('X6').value, 'November 2026');
    assert.equal(ws.getCell('X8').value, '11');
    assert.equal(ws.getCell('AC8').value, 'STEM A');
  });
  await check('dates in row 11, day letters in row 12, weekdays only', () => {
    const days = schoolDaysOfMonth(2026, 11);
    assert.equal(days.length, 21);
    assert.equal(ws.getCell('D11').value, 2);       // 2 November 2026 is a Monday
    assert.equal(ws.getCell('D12').value, 'M');
    assert.ok(days.every((d) => ['M', 'T', 'W', 'TH', 'F'].includes(d.letter)));
  });
  await check('males in rows 14+, females in rows 36+, numbered per block', () => {
    assert.equal(ws.getCell('A14').value, 1);
    assert.equal(ws.getCell('B14').value, 'GarciaA, Juan');
    assert.equal(ws.getCell('B36').value, 'SantosA, Juan');
    assert.match(String(ws.getCell('A35').value), /MALE\s+\|\s+TOTAL Per Day/);
    assert.match(String(ws.getCell('A61').value), /FEMALE\s+\|\s+TOTAL Per Day/);
  });

  const big = await load(await buildSf2Template({ ...base, month: 10, year: 2026, learners: [...learners(24, 'M', 'Reyes'), ...learners(28, 'F', 'Cruz')] }));
  const wb = big.worksheets[0];
  await check('a large section gets extra rows, and the totals move down with them', () => {
    assert.match(String(wb.getCell('A38').value), /MALE\s+\|\s+TOTAL Per Day/);     // 35 + 3
    assert.equal(wb.getCell('B37').value, 'ReyesX, Juan');                          // 24th male
    assert.equal(wb.getCell('B39').value, 'CruzA, Juan');                           // first female
    assert.match(String(wb.getCell('A67').value), /FEMALE\s+\|\s+TOTAL Per Day/);   // 61 + 3 + 3
    assert.match(String(wb.getCell('A68').value), /Combined TOTAL PER DAY/);
    assert.equal(wb.getCell('A70').value, 'GUIDELINES:');
  });

  console.log(`\n${passed} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
