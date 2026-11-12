// Exercises services/outlookCalculator.js with no database — the DepEd
// DO 015 rules behind Analytics' Learner Outlook tab.
// Run with: node scripts/testOutlookCalculator.js
const { promotionOutlook, subjectsCausingFailure, componentProfile, earlyWarning, absenceAlert } = require('../services/outlookCalculator');

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

// One finalized grade row.
const row = (studentId, offeringId, grade, extra = {}) => ({
  student_id: studentId,
  first_name: `F${studentId}`,
  last_name: `L${studentId}`,
  current_section_id: 1,
  section_name: 'STEM A',
  grade_level: 11,
  strand: 'STEM',
  class_offering_id: offeringId,
  subject_name: `Subject ${offeringId}`,
  grade_value: grade,
  ...extra,
});

console.log('promotionOutlook — DO 015 ¶67');
{
  const rows = [
    // learner 1: passes everything
    row(1, 1, 80), row(1, 2, 90), row(1, 3, 75),
    // learner 2: fails one (74) → summer remedial
    row(2, 1, 74), row(2, 2, 80), row(2, 3, 85),
    // learner 3: fails exactly two → still summer remedial (at most two)
    row(3, 1, 70), row(3, 2, 72), row(3, 3, 80),
    // learner 4: fails three → retention risk (more than two)
    row(4, 1, 70), row(4, 2, 72), row(4, 3, 60),
  ];
  const result = promotionOutlook(rows);
  assertEqual(result.counts, { on_track: 1, summer_remedial: 2, retention_risk: 1 }, 'categories counted by the number of subjects below 75');
  assertEqual(result.learners[0].category, 'retention_risk', 'worst outlook is listed first');
  assertEqual(result.learners.find((l) => l.studentId === 3).category, 'summer_remedial', 'two failed subjects is summer remedial, not retention');
  assertEqual(result.learners.find((l) => l.studentId === 1).category, 'on_track', '75 is passing');
}
{
  // A subject's grade so far is the average of its finalized terms, rounded:
  // 74 and 76 average 75 → passing.
  const result = promotionOutlook([row(5, 1, 74), row(5, 1, 76)]);
  assertEqual(result.learners[0].category, 'on_track', 'term grades 74 and 76 average to a passing 75');
  const result2 = promotionOutlook([row(6, 1, 74), row(6, 1, 74.4)]);
  assertEqual(result2.learners[0].failing, [{ subjectName: 'Subject 1', grade: 74 }], 'an average below 74.5 rounds to a failing 74');
}

console.log('\nsubjectsCausingFailure');
{
  const rows = [row(1, 1, 70), row(2, 1, 72), row(3, 1, 80), row(1, 2, 90), row(2, 2, 85), row(3, 2, 74)];
  const result = subjectsCausingFailure(rows);
  assertEqual(result.map((s) => [s.classOfferingId, s.failing, s.learners]), [[1, 2, 3], [2, 1, 3]], 'worst subject first, with failing / total learners');
  assertEqual(result[0].failingShare, 66.7, 'share failing as a percentage');
  assertEqual(result[0].average, 74, 'average grade of the subject');
}

console.log('\ncomponentProfile and earlyWarning — DO 015 ¶68');
{
  const comp = (key, ps) => ({ key, label: key, weight: 0.3, percentageScore: ps });
  const computations = [
    { studentId: 1, name: 'A', sectionName: 'S', classOfferingId: 9, subjectName: 'Math', computed: { complete: true, termGrade: 72, initialGrade: 62, missing: [], components: [comp('ww', 80), comp('pt', 85), comp('ex', 40)] } },
    { studentId: 2, name: 'B', sectionName: 'S', classOfferingId: 9, subjectName: 'Math', computed: { complete: true, termGrade: 88, initialGrade: 85, missing: [], components: [comp('ww', 90), comp('pt', 85), comp('ex', 80)] } },
    { studentId: 3, name: 'C', sectionName: 'S', classOfferingId: 9, subjectName: 'Math', computed: { complete: false, termGrade: null, initialGrade: null, missing: ['No score for Quiz 2', 'No score for Task 1'], components: [comp('ww', null), comp('pt', null), comp('ex', 70)] } },
  ];
  const profile = componentProfile(computations);
  assertEqual(profile[0].weakest, 'ex', 'the weakest component is identified (exams)');
  assertEqual(profile[0].components.find((c) => c.key === 'ex').average, 63.3, 'EX average over learners with a complete EX: (40+80+70)/3');
  assertEqual(profile[0].components.find((c) => c.key === 'ex').struggling, 1, 'one learner below 70% in exams');
  const warning = earlyWarning(computations);
  assertEqual(warning.belowPassing.map((w) => [w.studentId, w.provisionalGrade]), [[1, 72]], 'provisional grade below 75 is flagged');
  assertEqual(warning.missingWork.map((w) => [w.studentId, w.missingCount]), [[3, 2]], 'missing scores are counted');
  assertEqual([warning.learnersBelowPassing, warning.learnersMissingWork], [1, 1], 'learner totals');
}

console.log('\nabsenceAlert — DO 015 ¶70 (twelve absences)');
{
  const a = (id, absent, excused, days) => ({ student_id: id, first_name: 'F', last_name: `L${id}`, section_name: 'S', absent, excused, recorded_days: days });
  const result = absenceAlert([a(1, 12, 0, 60), a(2, 10, 1, 60), a(3, 8, 0, 60), a(4, 6, 6, 60), a(5, 0, 0, 60)]);
  assertEqual(result.alert, 2, 'twelve absences (absent + excused) is an alert');
  assertEqual(result.approaching, 1, 'nine to eleven is approaching');
  assertEqual(result.learners.map((l) => l.studentId), [1, 4, 2], 'eight or fewer are not listed; most absences first');
  assertEqual(result.learners[0].attendanceRate, 80, 'attendance rate shown beside it');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
