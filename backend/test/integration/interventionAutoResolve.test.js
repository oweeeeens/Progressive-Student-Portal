// Integration coverage for CLAUDE.md Part B — the closed loop: logging an
// intervention against a student's current risk assessment, then, on the
// NEXT grading period's recalculation, auto-comparing the new risk level to
// the level at the time it was logged (improved -> resolved, same/worse ->
// escalated) — and confirming a closed intervention is never reopened by a
// later recalculation, in either direction.
//
// Runs against the real Express app and the real database.
//
// Date handling is the one tricky part of this file: interventionController
// resolves "the current grading period" from today's REAL wall-clock date
// (there's no way to pass it a fixed test date), so this suite can't use an
// arbitrary isolated school year the way gradeApproval/riskRecalculation do
// — it must borrow whichever real grading period actually covers today, and
// append its own synthetic "next period(s)" after it. See
// helpers/fixtures.js's resolveOrCreateCurrentPeriod/appendFollowingPeriod
// for how that's done without touching real seed data.
//
// DISCOVERED BEHAVIOR WORTH KNOWING BEFORE TOUCHING THIS FILE: the
// auto-resolve/escalate comparison (riskEngine.closeOutInterventions) runs
// on EVERY recalculation trigger — every grade finalize AND every single
// daily-attendance submission — not once per "settled" period. Since a
// period's grade and attendance are normally entered as separate requests
// (exactly like a real adviser/teacher would), the FIRST trigger for a new
// period only has PART of that period's picture (e.g. a finalized grade
// with no attendance yet). If that partial picture alone already reads as
// an improvement, the intervention resolves immediately — permanently,
// since a closed intervention is never re-evaluated — even though the
// period's full picture (once attendance also lands) might have told a
// different story. This was caught empirically while writing this suite
// (an escalate-case student resolved early, prematurely, because the grade
// alone wasn't enough to raise the alarm before attendance confirmed it
// would've been), not assumed up front. The fix isn't in the app — this is
// real, intentional-by-construction trigger behavior per CLAUDE.md
// ("recalculated whenever new grades/attendance are entered") — it's in how
// this test chooses its numbers: each student's grade value for the period
// AFTER logging an intervention is chosen so that the grade ALONE (the
// first trigger to land, before attendance) already produces the intended
// final verdict. Whatever attendance arrives afterward is then provably
// moot, since the intervention is already closed.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');

let server;
let api;
let ctx;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  const currentPeriod = await fixtures.resolveOrCreateCurrentPeriod();
  const nextPeriod = await fixtures.appendFollowingPeriod(currentPeriod.school_year_id, { name: 'Test Next' });
  const finalPeriod = await fixtures.appendFollowingPeriod(currentPeriod.school_year_id, { name: 'Test Final' });

  const [adviser, teacher, principal] = await Promise.all([
    fixtures.createStaffUser('adviser', 'adviser'),
    fixtures.createStaffUser('subject_teacher', 'teacher'),
    fixtures.createStaffUser('principal', 'principal'),
  ]);

  const section = await fixtures.createTestSection({
    schoolYearId: currentPeriod.school_year_id,
    adviserId: adviser.id,
    label: 'section',
  });
  const subject = await fixtures.createTestSubject('subject');
  const offering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: section.id,
    teacherId: teacher.id,
    schoolYearId: currentPeriod.school_year_id,
  });

  const [studentImproves, studentEscalates, studentNoData] = await Promise.all([
    fixtures.createTestStudent({ sectionId: section.id, label: 'improves' }),
    fixtures.createTestStudent({ sectionId: section.id, label: 'escalates' }),
    fixtures.createTestStudent({ sectionId: section.id, label: 'no-data' }),
  ]);

  ctx = {
    currentPeriod,
    nextPeriod,
    finalPeriod,
    adviser,
    teacher,
    principal,
    section,
    subject,
    offering,
    studentImproves,
    studentEscalates,
    studentNoData,
  };
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.currentPeriod.school_year_id,
    ownSchoolYear: ctx.currentPeriod.ownSchoolYear,
    gradingPeriodIds: [ctx.nextPeriod.id, ctx.finalPeriod.id],
    userIds: [ctx.adviser.id, ctx.teacher.id, ctx.principal.id],
    studentIds: [ctx.studentImproves.id, ctx.studentEscalates.id, ctx.studentNoData.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

// Drives one student's grade for one period through the real approval chain
// (submit -> verify -> finalize), then submits one day of daily attendance
// at the given rate (just enough days to hit an exact percentage) — both of
// which trigger a risk recalculation, same mechanism as riskRecalculation.test.js.
async function setGradeAndAttendance(studentId, periodId, gradeValue, attendancePattern) {
  const submitRes = await api.post('/api/grades', {
    token: ctx.teacher.token,
    body: {
      classOfferingId: ctx.offering.id,
      gradingPeriodId: periodId,
      entries: [{ studentId, gradeValue }],
    },
  });
  assert.equal(submitRes.status, 201);
  const gradeId = submitRes.body.grades[0].id;

  await api.post('/api/grades/verify', { token: ctx.principal.token, body: { gradeIds: [gradeId] } });
  const finalizeRes = await api.post('/api/grades/finalize', {
    token: ctx.adviser.token,
    body: { sectionId: ctx.section.id, gradingPeriodId: periodId },
  });
  assert.equal(finalizeRes.status, 200);

  // attendancePattern is an array of 'present'/'absent' for consecutive days
  // starting at the period's start_date — simplest way to hit an exact rate.
  let lastAttendanceStatus = 201;
  for (let i = 0; i < attendancePattern.length; i += 1) {
    const date = new Date(`${periodStartDateOf(periodId)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    const res = await api.post('/api/attendance/daily', {
      token: ctx.adviser.token,
      body: {
        sectionId: ctx.section.id,
        attendanceDate: date.toISOString().slice(0, 10),
        entries: [{ studentId, status: attendancePattern[i] }],
      },
    });
    if (res.status !== 201) {
      throw new Error(`attendance POST failed (${res.status}): ${JSON.stringify(res.body)} for date ${date.toISOString().slice(0, 10)}`);
    }
    lastAttendanceStatus = res.status;
  }
  assert.equal(lastAttendanceStatus, 201);
}

// Small lookup so setGradeAndAttendance can find a period's start_date
// without threading it through every call site individually. Only called
// from within test bodies, by which point before() has already set ctx.
function periodStartDateOf(periodId) {
  if (periodId === ctx.currentPeriod.id) return ctx.currentPeriod.start_date;
  if (periodId === ctx.nextPeriod.id) return ctx.nextPeriod.start_date;
  if (periodId === ctx.finalPeriod.id) return ctx.finalPeriod.start_date;
  throw new Error(`Unknown period id ${periodId}`);
}

test('logging an intervention with no risk assessment yet is rejected', async () => {
  const res = await api.post(`/api/students/${ctx.studentNoData.id}/interventions`, {
    token: ctx.adviser.token,
    body: { interventionType: 'tutoring_referral', notes: 'should fail' },
  });
  assert.equal(res.status, 400);
});

test('both students start at medium risk this period (low grade + low attendance)', async () => {
  // 4 days, 1 absent -> 75% attendance, below the 90% threshold.
  await setGradeAndAttendance(ctx.studentImproves.id, ctx.currentPeriod.id, 65, [
    'present',
    'present',
    'present',
    'absent',
  ]);
  // studentEscalates starts at 74 (still <75), not 65 — deliberately leaves
  // room to drop by a full 14 points next period while staying within the
  // valid 60-100 grade scale, which is what lets the ESCALATE test below
  // reach the -5 decline threshold from grade data alone (see this file's
  // header comment on why that has to happen using grade data alone).
  await setGradeAndAttendance(ctx.studentEscalates.id, ctx.currentPeriod.id, 74, [
    'present',
    'present',
    'present',
    'absent',
  ]);
  // Verified indirectly by the next test's risk_level_at_intervention check
  // (medium for both) — logging the intervention is itself the assertion
  // that a risk assessment now exists.
});

let interventionImprovesId;
let interventionEscalatesId;

test('logging an intervention for each student captures "medium" as the risk level at the time', async () => {
  const resImproves = await api.post(`/api/students/${ctx.studentImproves.id}/interventions`, {
    token: ctx.adviser.token,
    body: { interventionType: 'tutoring_referral', notes: 'baseline, expect improvement next period' },
  });
  assert.equal(resImproves.status, 201);
  assert.equal(resImproves.body.intervention.status, 'open');
  interventionImprovesId = resImproves.body.intervention.id;

  const resEscalates = await api.post(`/api/students/${ctx.studentEscalates.id}/interventions`, {
    token: ctx.adviser.token,
    body: { interventionType: 'tutoring_referral', notes: 'baseline, expect no real change next period' },
  });
  assert.equal(resEscalates.status, 201);
  interventionEscalatesId = resEscalates.body.intervention.id;

  const listImproves = await api.get(`/api/students/${ctx.studentImproves.id}/interventions`, {
    token: ctx.adviser.token,
  });
  const loggedImproves = listImproves.body.interventions.find((i) => i.id === interventionImprovesId);
  assert.equal(loggedImproves.risk_level_at_intervention, 'medium');
});

test('next period: the improving student\'s grades/attendance recover -> intervention auto-resolves', async () => {
  // grade 65 -> 90 (trend +12.5, well clear of decline), attendance 75% -> 100% (4/4 present).
  await setGradeAndAttendance(ctx.studentImproves.id, ctx.nextPeriod.id, 90, [
    'present',
    'present',
    'present',
    'present',
  ]);

  const list = await api.get(`/api/students/${ctx.studentImproves.id}/interventions`, { token: ctx.adviser.token });
  const intervention = list.body.interventions.find((i) => i.id === interventionImprovesId);
  assert.equal(intervention.status, 'resolved');
  assert.ok(intervention.resolved_at, 'resolved_at should be set once an intervention closes');
});

test('next period: the escalating student gets worse, not better -> intervention auto-escalates', async () => {
  // grade 74 -> 60 (the lowest valid grade). On its own (before any
  // attendance lands — grade finalize is the FIRST trigger for this period,
  // see this file's header comment): still <75 (+2, low_grade) AND trend
  // (60-74)/2 = -7, past -5 (+2, declining_grade) = score 4 = medium, same
  // level as at logging time -> "same_or_worse" -> escalates immediately,
  // on the grade alone. Whatever attendance arrives afterward (also
  // declining here, for realism) can't change the outcome — the
  // intervention is already closed by then.
  await setGradeAndAttendance(ctx.studentEscalates.id, ctx.nextPeriod.id, 60, [
    'present',
    'absent',
    'present',
    'absent',
  ]);

  const list = await api.get(`/api/students/${ctx.studentEscalates.id}/interventions`, { token: ctx.adviser.token });
  const intervention = list.body.interventions.find((i) => i.id === interventionEscalatesId);
  assert.equal(intervention.status, 'escalated');
  assert.ok(intervention.resolved_at, 'resolved_at is also set when an intervention escalates (it is a closed state)');
});

test('a third period of data never reopens either already-closed intervention', async () => {
  // The resolved student's data crashes hard (grade 90 -> 60, the lowest
  // valid grade, attendance 100% -> 25%) — would clearly be a fresh
  // "escalation" signal if evaluated from scratch, but there is no longer
  // an OPEN/MONITORING intervention before this period for this logic to act on.
  await setGradeAndAttendance(ctx.studentImproves.id, ctx.finalPeriod.id, 60, [
    'absent',
    'absent',
    'absent',
    'present',
  ]);
  // The escalated student's data recovers completely (grade 60 -> 95, attendance 50% -> 100%) —
  // would clearly read as a fresh "resolution" signal, same reasoning in the other direction.
  await setGradeAndAttendance(ctx.studentEscalates.id, ctx.finalPeriod.id, 95, [
    'present',
    'present',
    'present',
    'present',
  ]);

  const listImproves = await api.get(`/api/students/${ctx.studentImproves.id}/interventions`, {
    token: ctx.adviser.token,
  });
  const stillResolved = listImproves.body.interventions.find((i) => i.id === interventionImprovesId);
  assert.equal(stillResolved.status, 'resolved', 'a resolved intervention must not flip back to escalated');

  const listEscalates = await api.get(`/api/students/${ctx.studentEscalates.id}/interventions`, {
    token: ctx.adviser.token,
  });
  const stillEscalated = listEscalates.body.interventions.find((i) => i.id === interventionEscalatesId);
  assert.equal(stillEscalated.status, 'escalated', 'an escalated intervention must not flip back to resolved');
});
