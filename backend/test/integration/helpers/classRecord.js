// Test helper: give learners specific term grades the way the System now
// requires — by recording scores in the Class Record and submitting the
// computed result — instead of typing the grade (POST /api/grades no longer
// exists; see classRecordController.js).
//
// Most integration tests are about what happens AFTER a grade exists (the
// approval chain, risk, interventions), so they still want to say "this
// learner gets 70". This helper turns that into scores that compute to 70:
// one Written Work, one Performance Task and the three exam parts, each out
// of 100, every learner scoring the middle of the transmutation band that
// yields the wanted grade. The calculator then produces exactly that grade —
// the round trip is itself a check on gradeCalculator.js.
//
// It answers in the shape the old endpoint did ({ status, body: { grades,
// skippedFinalizedStudentIds, message } }) so the existing assertions about
// the approval chain stay unchanged.
const { TRANSMUTATION_TABLE } = require('../../../config/gradingPolicy');

const TEST_ITEMS = [
  { component: 'ww', examPart: null, title: 'Test written work' },
  { component: 'pt', examPart: null, title: 'Test performance task' },
  { component: 'ex', examPart: 'st1', title: 'Test summative test 1' },
  { component: 'ex', examPart: 'st2', title: 'Test summative test 2' },
  { component: 'ex', examPart: 'te', title: 'Test term exam' },
];

// The percentage every item is scored at so the Initial Grade lands in the
// middle of the band for `termGrade` — far from either edge, so two-decimal
// rounding inside the computation can never tip it into a neighbour.
function percentForTermGrade(termGrade) {
  const index = TRANSMUTATION_TABLE.findIndex(([, grade]) => grade === termGrade);
  if (index === -1) throw new Error(`No transmutation band yields ${termGrade}`);
  const minimum = TRANSMUTATION_TABLE[index][0];
  const nextMinimum = index === 0 ? 100.01 : TRANSMUTATION_TABLE[index - 1][0];
  return Math.round(((minimum + nextMinimum) / 2) * 100) / 100;
}

async function submitGrades(api, { token, body }) {
  const { classOfferingId, gradingPeriodId, entries } = body;
  const query = `classOfferingId=${classOfferingId}&gradingPeriodId=${gradingPeriodId}`;

  const opened = await api.get(`/api/class-record?${query}`, { token });
  if (opened.status !== 200) return opened;
  if (!opened.body.canEdit) {
    return { status: 403, body: { error: 'Only the teacher of this class can change its class record.' } };
  }

  // The five test items, created once per class and term and reused.
  const items = [...opened.body.items];
  for (const spec of TEST_ITEMS) {
    if (items.some((i) => i.title === spec.title)) continue;
    const created = await api.post('/api/class-record/items', {
      token,
      body: { classOfferingId, gradingPeriodId, ...spec, highestPossibleScore: 100 },
    });
    if (created.status !== 201) return created;
    items.push(created.body.item);
  }
  const testItems = items.filter((i) => TEST_ITEMS.some((t) => t.title === i.title));

  // A finalized learner's scores are locked; they are still named in the
  // submit so the response reports them as skipped, as before.
  const finalized = new Set(
    opened.body.learners.filter((l) => l.grade?.status === 'finalized').map((l) => l.studentId)
  );
  const scores = [];
  for (const entry of entries) {
    if (finalized.has(entry.studentId)) continue;
    const percent = percentForTermGrade(entry.gradeValue);
    for (const item of testItems) scores.push({ itemId: item.id, studentId: entry.studentId, rawScore: percent });
  }
  if (scores.length > 0) {
    const saved = await api.put('/api/class-record/scores', { token, body: { classOfferingId, gradingPeriodId, scores } });
    if (saved.status !== 200) return saved;
  }

  const submitted = await api.post('/api/class-record/submit', {
    token,
    body: { classOfferingId, gradingPeriodId, studentIds: entries.map((e) => e.studentId) },
  });
  // Everything named was finalized: the old endpoint answered 201 with an
  // empty list and the skipped ids, so do the same.
  if (submitted.status === 400 && entries.every((e) => finalized.has(e.studentId))) {
    return { status: 201, body: { grades: [], skippedFinalizedStudentIds: entries.map((e) => e.studentId), message: 'already finalized' } };
  }
  if (submitted.status !== 201) return submitted;
  const skipped = submitted.body.skippedFinalized.map((s) => s.studentId);
  return {
    status: 201,
    body: {
      grades: submitted.body.grades,
      skippedFinalizedStudentIds: skipped,
      ...(skipped.length > 0 && { message: `${skipped.length} grade(s) were already finalized by the adviser and left unchanged.` }),
    },
  };
}

module.exports = { submitGrades, percentForTermGrade };
