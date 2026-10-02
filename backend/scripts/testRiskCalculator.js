// Exercises services/riskCalculator.js directly, with no database involved —
// proof the formula itself is correct, independent of how the numbers are
// fetched. Run with: node scripts/testRiskCalculator.js
const { calculateTrend, calculateRiskScore, compareRiskLevels } = require('../services/riskCalculator');

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

console.log('calculateTrend');
assertEqual(calculateTrend([90, 85, 80]), (80 - 90) / 3, 'declining series computes (last-first)/count');
assertEqual(calculateTrend([80, 85, 90]), (90 - 80) / 3, 'improving series gives a positive trend');
assertEqual(calculateTrend([85]), null, 'a single data point cannot produce a trend (null, not 0)');
assertEqual(calculateTrend([]), null, 'no data points cannot produce a trend');
assertEqual(calculateTrend([85, 85]), 0, 'two equal values produce a flat (zero) trend');

console.log('\ncalculateRiskScore — thresholds');
assertEqual(
  calculateRiskScore({ currentGrade: 75, gradeTrend: null, currentAttendanceRate: 95, attendanceTrend: null }).score,
  0,
  'grade exactly AT the threshold (75) does not trigger — threshold is strictly "<"'
);
assertEqual(
  calculateRiskScore({ currentGrade: 74.9, gradeTrend: null, currentAttendanceRate: 95, attendanceTrend: null }).score,
  2,
  'grade just below the threshold does trigger'
);
assertEqual(
  calculateRiskScore({ currentGrade: 90, gradeTrend: -5, currentAttendanceRate: 95, attendanceTrend: null }).score,
  2,
  'grade trend exactly AT -5 does trigger — threshold is "<=", unlike the grade threshold'
);
assertEqual(
  calculateRiskScore({ currentGrade: 90, gradeTrend: -4.9, currentAttendanceRate: 95, attendanceTrend: null }).score,
  0,
  'grade trend just above -5 (e.g. -4.9) does not trigger'
);

console.log('\ncalculateRiskScore — missing data never penalizes');
assertEqual(
  calculateRiskScore({ currentGrade: null, gradeTrend: null, currentAttendanceRate: null, attendanceTrend: null }),
  { score: 0, level: 'low', factors: [] },
  'no data at all (e.g. first grading period, nothing finalized yet) scores 0, not high risk'
);

console.log('\ncalculateRiskScore — full scenarios and level bands');
const noRisk = calculateRiskScore({ currentGrade: 88, gradeTrend: 1, currentAttendanceRate: 97, attendanceTrend: 0 });
assertEqual({ score: noRisk.score, level: noRisk.level }, { score: 0, level: 'low' }, 'healthy student -> low risk, 0 factors');

const oneFactorMedium = calculateRiskScore({
  currentGrade: 70,
  gradeTrend: -6,
  currentAttendanceRate: 95,
  attendanceTrend: 0,
});
assertEqual(
  { score: oneFactorMedium.score, level: oneFactorMedium.level, factorKeys: oneFactorMedium.factors.map((f) => f.key) },
  { score: 4, level: 'medium', factorKeys: ['low_grade', 'declining_grade'] },
  'low grade + declining grade = 2 factors = score 4 = medium'
);

const allFourHigh = calculateRiskScore({
  currentGrade: 65,
  gradeTrend: -10,
  currentAttendanceRate: 80,
  attendanceTrend: -8,
});
assertEqual(
  { score: allFourHigh.score, level: allFourHigh.level, factorCount: allFourHigh.factors.length },
  { score: 8, level: 'high', factorCount: 4 },
  'all four factors triggered = score 8 = high'
);

console.log('\ncompareRiskLevels — intervention outcome comparison');
assertEqual(compareRiskLevels('high', 'medium'), 'improved', 'high -> medium is an improvement');
assertEqual(compareRiskLevels('high', 'low'), 'improved', 'high -> low is an improvement');
assertEqual(compareRiskLevels('medium', 'low'), 'improved', 'medium -> low is an improvement');
assertEqual(compareRiskLevels('medium', 'medium'), 'same_or_worse', 'unchanged level counts as same_or_worse, not improved');
assertEqual(compareRiskLevels('medium', 'high'), 'same_or_worse', 'getting worse is same_or_worse');
assertEqual(compareRiskLevels('low', 'medium'), 'same_or_worse', 'low -> medium is a regression, not an improvement');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
