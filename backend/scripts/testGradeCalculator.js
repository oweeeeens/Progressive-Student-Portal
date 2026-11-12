// Exercises services/gradeCalculator.js directly, with no database — proof
// the DepEd computation itself is right. The two headline cases are DepEd's
// OWN worked examples printed in DO 015, s. 2026, Annex D (Tables 5 and 6),
// so if these pass the System grades the way the order does.
// Run with: node scripts/testGradeCalculator.js
const { computeTermGrade, transmute, toTermGrade } = require('../services/gradeCalculator');
const { TRANSMUTATION_TABLE } = require('../config/gradingPolicy');

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, description) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  PASS: ${description}`);
  } else {
    failed += 1;
    console.log(`  FAIL: ${description}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

// Builds a class record from compact lists: [[hps, raw], ...] per component.
function record({ ww = [], pt = [], st1 = [], st2 = [], te = [] }) {
  const items = [];
  const scores = new Map();
  let id = 1;
  const add = (component, examPart, list, label) =>
    list.forEach(([hps, raw], i) => {
      items.push({ id, component, examPart, title: `${label} ${i + 1}`, highestPossibleScore: hps });
      if (raw !== null) scores.set(id, raw);
      id += 1;
    });
  add('ww', null, ww, 'WW');
  add('pt', null, pt, 'PT');
  add('ex', 'st1', st1, 'ST1');
  add('ex', 'st2', st2, 'ST2');
  add('ex', 'te', te, 'TE');
  return { items, scores };
}

console.log("DepEd's worked example — DO 015 Annex D, Table 5 (Science, transmuted)");
{
  const r = computeTermGrade({
    ...record({
      ww: [[20, 17], [25, 22], [20, 20], [20, 15]],
      pt: [[25, 20], [25, 23]],
      st1: [[20, 15]],
      st2: [[20, 18]],
      te: [[40, 35]],
    }),
    weightGroup: 'core',
  });
  const [ww, pt, ex] = r.components;
  assertEqual([ww.rawScore, ww.highestPossibleScore, ww.percentageScore, ww.weightedScore], [74, 85, 87.06, 17.41], 'WW: 74/85 = 87.06% × 20% = 17.41');
  assertEqual([pt.rawScore, pt.percentageScore, pt.weightedScore], [43, 86, 43], 'PT: 43/50 = 86% × 50% = 43');
  assertEqual(ex.parts.map((p) => p.weightedScore), [22.5, 27, 35], 'EX parts: ST1 22.5, ST2 27, TE 35 (30/30/40)');
  assertEqual([ex.percentageScore, ex.weightedScore], [84.5, 25.35], 'EX: 84.5% × 30% = 25.35');
  assertEqual(r.initialGrade, 85.76, 'Initial Grade 85.76 (the order prints it as 85.8)');
  assertEqual(r.termGrade, 88, 'Term Grade 88 — matches the order');
  assertEqual(r.complete, true, 'every item scored → complete');
}

console.log("\nDepEd's worked example — Annex D, Table 6 (Mathematics, zero-based)");
{
  const r = computeTermGrade({
    ...record({
      ww: [[20, 15], [25, 22], [20, 20]],
      pt: [[25, 20], [25, 23], [25, 20]],
      st1: [[25, 19]],
      st2: [[20, 16]],
      te: [[50, 42]],
    }),
    weightGroup: 'core',
    mode: 'zero_based',
  });
  assertEqual(r.components[0].percentageScore, 87.69, 'WW 57/65 = 87.69% (the order rounds to 87.7)');
  assertEqual(r.components[2].percentageScore, 80.4, 'EX 22.8 + 24 + 33.6 = 80.4%');
  assertEqual(r.initialGrade, 83.66, 'IG 83.66 (the order shows 83.6 from its one-decimal WSs)');
  assertEqual(r.termGrade, 84, 'Term Grade 84 — no transmutation, rounded; matches the order');
}

console.log('\ntransmute — every band edge of the SY 2026–2027 table');
for (let i = 0; i < TRANSMUTATION_TABLE.length; i += 1) {
  const [minimum, grade] = TRANSMUTATION_TABLE[i];
  assertEqual(transmute(minimum), grade, `IG ${minimum.toFixed(2)} → ${grade} (bottom of its band)`);
  if (i > 0) {
    const top = Math.round((TRANSMUTATION_TABLE[i - 1][0] - 0.01) * 100) / 100;
    assertEqual(transmute(top), grade, `IG ${top.toFixed(2)} → ${grade} (top of its band)`);
  }
}
assertEqual(transmute(100), 100, 'IG 100 → 100');
assertEqual(transmute(69.99), 74, 'IG 69.99 → 74: one hundredth short of passing');
assertEqual(transmute(70), 75, 'IG 70.00 → 75: the passing threshold the order sets');

console.log('\nzero-based rule');
assertEqual(toTermGrade(83.5, 'zero_based'), 84, '83.5 rounds up to 84');
assertEqual(toTermGrade(41.2, 'zero_based'), 60, 'never reported below the minimum of 60');

console.log('\nsubject groups');
{
  const wi = computeTermGrade({ ...record({ ww: [[100, 90]], pt: [[100, 80]] }), weightGroup: 'work_immersion' });
  assertEqual(wi.complete, true, 'Work Immersion has no exam, so no exam is needed to complete it');
  assertEqual(wi.initialGrade, 82, 'Work Immersion: 90×20% + 80×80% = 82');
  assertEqual(wi.components.map((c) => c.key), ['ww', 'pt'], 'no EX component is reported for it');

  const fe = computeTermGrade({ ...record({ ww: [[100, 80]], pt: [[100, 80]], te: [[100, 80]] }), weightGroup: 'field_exposure' });
  assertEqual(fe.complete, true, 'Field Exposure needs only a Term Exam (no STs)');
  assertEqual(fe.components[2].parts.map((p) => [p.key, p.weight]), [['te', 1]], 'its TE carries the whole EX weight');
  assertEqual(fe.initialGrade, 80, 'Field Exposure 80/80/80 → IG 80');

  const tp = computeTermGrade({ ...record({ ww: [[100, 100]], pt: [[100, 50]], st1: [[100, 50]], st2: [[100, 50]], te: [[100, 50]] }), weightGroup: 'techpro_elective' });
  assertEqual(tp.initialGrade, 57.5, 'TechPro 15/65/20: 15 + 32.5 + 10 = 57.5');
}

console.log('\nmissing data is reported, never guessed');
{
  const blank = computeTermGrade({ ...record({ ww: [[20, 18], [20, null]], pt: [[50, 40]], st1: [[20, 15]], st2: [[20, 15]], te: [[40, 30]] }), weightGroup: 'core' });
  assertEqual(blank.complete, false, 'one blank score → incomplete');
  assertEqual([blank.initialGrade, blank.termGrade], [null, null], 'no grade is produced from partial data');
  assertEqual(blank.missing, ['No score for WW 2'], 'the blank item is named');

  const noExam = computeTermGrade({ ...record({ ww: [[20, 18]], pt: [[50, 40]], st1: [[20, 15]] }), weightGroup: 'core' });
  assertEqual(noExam.missing, ['No Summative Test 2 recorded yet', 'No Term Examination recorded yet'], 'missing exam parts are named');

  const zero = computeTermGrade({ ...record({ ww: [[20, 0]], pt: [[50, 0]], st1: [[20, 0]], st2: [[20, 0]], te: [[40, 0]] }), weightGroup: 'core' });
  assertEqual([zero.complete, zero.initialGrade, zero.termGrade], [true, 0, 60], 'a real score of 0 is a score: IG 0 → 60');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
