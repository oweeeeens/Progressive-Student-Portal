// Demo-data helper: a believable class record for one class and term, and,
// for a learner, a set of whole-number scores that COMPUTES to a chosen
// term grade.
//
// The demo dataset (demoDataset.js) was written as final grades per learner
// — "Cruz, Ben: 91 in Term 2". Grades are now computed from scores, so to
// keep every dashboard, risk band and intervention in the demo exactly as it
// was, each learner is given scores that land on the grade they already had.
// The scores are varied per learner (a little stronger in written work,
// weaker in tasks, or the reverse) so a breakdown looks like a real one,
// and every result is checked against the real calculator before use.
const { computeTermGrade } = require('../../services/gradeCalculator');
const { TRANSMUTATION_TABLE, TERM_EXAM_ONLY_GROUPS, WEIGHT_GROUPS } = require('../../config/gradingPolicy');

// Three quizzes, two tasks, the two summative tests and the term exam —
// the shape of a typical DepEd class record term.
const DEMO_ITEMS = [
  { component: 'ww', examPart: null, title: 'Quiz 1', highestPossibleScore: 20 },
  { component: 'ww', examPart: null, title: 'Quiz 2', highestPossibleScore: 25 },
  { component: 'ww', examPart: null, title: 'Seatwork 1', highestPossibleScore: 15 },
  { component: 'pt', examPart: null, title: 'Performance Task 1', highestPossibleScore: 50 },
  { component: 'pt', examPart: null, title: 'Performance Task 2', highestPossibleScore: 50 },
  { component: 'ex', examPart: 'st1', title: 'Summative Test 1', highestPossibleScore: 30 },
  { component: 'ex', examPart: 'st2', title: 'Summative Test 2', highestPossibleScore: 30 },
  { component: 'ex', examPart: 'te', title: 'Term Examination', highestPossibleScore: 50 },
];

// The items that apply to a subject's weight group (no exam for Research
// or Work Immersion; Term Exam only for Field Exposure).
function demoItemsFor(weightGroup) {
  const weights = WEIGHT_GROUPS[weightGroup] || WEIGHT_GROUPS.core;
  return DEMO_ITEMS.filter((item) => {
    if (item.component !== 'ex') return true;
    if (weights.ex === null) return false;
    return TERM_EXAM_ONLY_GROUPS.has(weightGroup) ? item.examPart === 'te' : true;
  });
}

// The initial grade in the middle of the band that transmutes to `grade`.
function targetInitialGrade(grade) {
  const index = TRANSMUTATION_TABLE.findIndex(([, g]) => g === grade);
  if (index === -1) return null;
  const low = TRANSMUTATION_TABLE[index][0];
  const high = index === 0 ? 100 : TRANSMUTATION_TABLE[index - 1][0];
  return (low + high) / 2;
}

// Small deterministic variation from a number, so the same learner gets the
// same scores on every run.
function wobble(seed, k) {
  const x = Math.sin(seed * 9301 + k * 49297) * 233280;
  return (x - Math.floor(x)) * 2 - 1; // -1 .. 1
}

// Whole-number scores for `items` (each with an id) that compute to
// `termGrade`. Returns Map(itemId -> score), or null if no combination found.
function scoresForGrade({ items, termGrade, weightGroup, seed }) {
  const ig = targetInitialGrade(Math.round(termGrade));
  if (ig === null) return null;
  // Per component, a percentage around the target, with a learner-specific
  // lean (strong in written work and weak in tasks, or the reverse).
  const lean = wobble(seed, 1) * 6;
  const percentFor = (item, k) => {
    const base = item.component === 'ww' ? ig + lean : item.component === 'pt' ? ig - lean / 2 : ig;
    return Math.min(100, Math.max(0, base + wobble(seed, k + 2) * 5));
  };
  const scores = new Map();
  items.forEach((item, k) => scores.set(item.id, Math.round((percentFor(item, k) / 100) * item.highestPossibleScore)));

  // Nudge one item at a time (the last item of the most heavily weighted
  // component first) until the real calculator lands on the grade.
  const adjustable = [...items].reverse();
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = computeTermGrade({ items, scores, weightGroup });
    if (result.termGrade === Math.round(termGrade)) return scores;
    const direction = result.termGrade < termGrade ? 1 : -1;
    const item = adjustable[attempt % adjustable.length];
    const next = scores.get(item.id) + direction;
    if (next >= 0 && next <= item.highestPossibleScore) scores.set(item.id, next);
  }
  return null;
}

module.exports = { DEMO_ITEMS, demoItemsFor, scoresForGrade };
