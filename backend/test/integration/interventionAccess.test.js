// Integration coverage for the intervention access rule: a learner's
// interventions belong to the adviser of their section ONLY — no school-wide
// role, and no teacher who merely teaches the section (the research
// adviser's "no third parties", see interventionController.js). Everyone
// else still gets the anonymous totals on Analytics.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

let server;
let api;
let ctx;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  // Logging requires a risk assessment in TODAY's grading period, so this
  // borrows (or creates) the real current period, like the auto-resolve suite.
  const currentPeriod = await fixtures.resolveOrCreateCurrentPeriod();
  const [adviser, teachingAdviser, admin, principal, guidance] = await Promise.all([
    fixtures.createStaffUser('adviser', 'ia-adviser'),
    // Advises a DIFFERENT section and teaches into this one — the case the
    // old union scope let through.
    fixtures.createStaffUser('adviser', 'ia-teaching-adviser'),
    fixtures.createStaffUser('admin', 'ia-admin'),
    fixtures.createStaffUser('principal', 'ia-principal'),
    fixtures.createStaffUser('guidance_counselor', 'ia-guidance'),
  ]);
  const section = await fixtures.createTestSection({ schoolYearId: currentPeriod.school_year_id, adviserId: adviser.id, label: 'ia-section' });
  const otherSection = await fixtures.createTestSection({ schoolYearId: currentPeriod.school_year_id, adviserId: teachingAdviser.id, label: 'ia-other' });
  const subject = await fixtures.createTestSubject('ia-subject');
  const offering = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: section.id, teacherId: teachingAdviser.id, schoolYearId: currentPeriod.school_year_id });
  const learner = await fixtures.createTestStudent({ sectionId: section.id, label: 'ia-learner' });

  // A flagged risk assessment for today's period, written directly: this
  // suite is about who may act on it, not how it was calculated.
  await pool.query(
    `INSERT INTO risk_assessments (student_id, grading_period_id, average_grade, grade_trend, attendance_rate, attendance_trend, risk_score, risk_level, calculated_at)
     VALUES ($1, $2, 70, NULL, 80, NULL, 4, 'medium', now())`,
    [learner.id, currentPeriod.id]
  );

  ctx = { currentPeriod, adviser, teachingAdviser, admin, principal, guidance, section, otherSection, subject, offering, learner };
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.currentPeriod.school_year_id,
    ownSchoolYear: ctx.currentPeriod.ownSchoolYear,
    userIds: [ctx.adviser.id, ctx.teachingAdviser.id, ctx.admin.id, ctx.principal.id, ctx.guidance.id],
    studentIds: [ctx.learner.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id, ctx.otherSection.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

const learnerUrl = () => `/api/students/${ctx.learner.id}/interventions`;
let interventionId;

test("the learner's adviser can log an intervention", async () => {
  const res = await api.post(learnerUrl(), {
    token: ctx.adviser.token,
    body: { interventionType: 'counseling_referral', notes: 'Referred to the guidance office after a parent conference.' },
  });
  assert.equal(res.status, 201);
  interventionId = res.body.intervention.id;
});

test('nobody else can log one — not the principal, guidance, or a teacher of the section', async () => {
  for (const who of ['principal', 'guidance', 'teachingAdviser']) {
    const res = await api.post(learnerUrl(), { token: ctx[who].token, body: { interventionType: 'other', notes: 'x' } });
    assert.equal(res.status, 403, `${who} must be refused`);
  }
});

test("only the adviser and the admin can read the learner's interventions and their notes", async () => {
  const own = await api.get(learnerUrl(), { token: ctx.adviser.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.interventions.length, 1);
  assert.match(own.body.interventions[0].notes, /guidance office/);

  const asAdmin = await api.get(learnerUrl(), { token: ctx.admin.token });
  assert.equal(asAdmin.status, 200, 'the admin has full access (restored 2026-11-13)');
  assert.equal(asAdmin.body.interventions.length, 1);

  for (const who of ['principal', 'guidance', 'teachingAdviser']) {
    assert.equal((await api.get(learnerUrl(), { token: ctx[who].token })).status, 403, `${who} cannot read them`);
  }
});

test('the Interventions list shows advisory learners to an adviser, everyone to the admin', async () => {
  const mine = await api.get('/api/interventions', { token: ctx.adviser.token });
  assert.ok(mine.body.interventions.some((i) => i.id === interventionId), 'the adviser sees it');

  const adminList = await api.get('/api/interventions', { token: ctx.admin.token });
  assert.ok(adminList.body.interventions.some((i) => i.id === interventionId), 'the admin sees it');

  for (const who of ['guidance', 'teachingAdviser']) {
    const list = await api.get('/api/interventions', { token: ctx[who].token });
    assert.equal(list.status, 200);
    assert.ok(!list.body.interventions.some((i) => i.id === interventionId), `${who} does not see it`);
  }
});

test('only the adviser and the admin can change its status', async () => {
  for (const who of ['guidance', 'teachingAdviser']) {
    const res = await api.patch(`/api/interventions/${interventionId}/status`, { token: ctx[who].token, body: { status: 'monitoring' } });
    assert.equal(res.status, 403, `${who} must be refused`);
  }
  const ok = await api.patch(`/api/interventions/${interventionId}/status`, { token: ctx.adviser.token, body: { status: 'monitoring' } });
  assert.equal(ok.status, 200);
  const byAdmin = await api.patch(`/api/interventions/${interventionId}/status`, { token: ctx.admin.token, body: { status: 'open' } });
  assert.equal(byAdmin.status, 200, 'the admin can update it too');
});

test('the principal and guidance counselor still get the anonymous totals on Analytics', async () => {
  for (const who of ['principal', 'guidance']) {
    const res = await api.get('/api/analytics/intervention-effectiveness', { token: ctx[who].token });
    assert.equal(res.status, 200, `${who} reads the rollup`);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('guidance office'), 'no intervention notes in the rollup');
    assert.ok(!text.includes(ctx.learner.last_name), 'no learner names in the rollup');
  }
});
