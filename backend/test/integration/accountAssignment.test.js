// A new staff account is linked to its section and classes when it is made.
//
// Found in the group's demo: an adviser account created through New Account
// signed in to a near-empty menu, because every adviser feature is earned by
// sections.adviser_id / class_offerings.teacher_id and creating the account
// set neither. These tests prove the account forms now write those links —
// in one transaction, admin only, current school year only — and that the
// person can use the features the moment they sign in.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const { signTestToken } = require('./helpers/auth');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

let server;
let api;
const ctx = { userIds: [], sectionIds: [], offeringIds: [], subjectIds: [] };

const tag = () => `acct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  // Linking is only allowed into the CURRENT school year — the same filter
  // as /sections/mine — so these sections live in the real current year and
  // are removed again afterwards.
  const current = await pool.query('SELECT id FROM school_years WHERE is_current = TRUE LIMIT 1');
  assert.ok(current.rows[0], 'the dev database needs a current school year');
  ctx.currentYearId = current.rows[0].id;

  const { schoolYearId: pastYearId } = await fixtures.createSchoolYearWithPeriods('ACCTPAST', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2019-06-01', endDate: '2019-08-31' },
  ]);
  ctx.pastYearId = pastYearId;

  const [admin, registrar, holder] = await Promise.all([
    fixtures.createStaffUser('admin', 'acct-admin'),
    fixtures.createStaffUser('registrar', 'acct-registrar'),
    fixtures.createStaffUser('adviser', 'acct-holder'),
  ]);
  Object.assign(ctx, { admin, registrar, holder });
  ctx.userIds.push(admin.id, registrar.id, holder.id);

  // Two sections already advised by `holder`, and two classes taught by them.
  ctx.sectionA = await fixtures.createTestSection({ schoolYearId: ctx.currentYearId, adviserId: holder.id, label: 'acct-a' });
  ctx.sectionB = await fixtures.createTestSection({ schoolYearId: ctx.currentYearId, adviserId: holder.id, label: 'acct-b' });
  ctx.pastSection = await fixtures.createTestSection({ schoolYearId: pastYearId, adviserId: holder.id, label: 'acct-past' });
  ctx.sectionIds.push(ctx.sectionA.id, ctx.sectionB.id, ctx.pastSection.id);

  const subject = await fixtures.createTestSubject('acct-subject');
  ctx.subjectIds.push(subject.id);
  ctx.offering1 = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: ctx.sectionB.id, teacherId: holder.id, schoolYearId: ctx.currentYearId });
  const subject2 = await fixtures.createTestSubject('acct-subject2');
  ctx.subjectIds.push(subject2.id);
  ctx.offering2 = await fixtures.createTestOffering({ subjectId: subject2.id, sectionId: ctx.sectionB.id, teacherId: holder.id, schoolYearId: ctx.currentYearId });
  ctx.offeringIds.push(ctx.offering1.id, ctx.offering2.id);
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.pastYearId,
    ownSchoolYear: true,
    userIds: ctx.userIds,
    sectionIds: ctx.sectionIds,
    offeringIds: ctx.offeringIds,
    subjectIds: ctx.subjectIds,
  });
});

// What a real new user does first: change the temporary password (the server
// refuses everything else until they do), then use the fresh token it returns.
async function firstSignIn(res) {
  const changed = await api.post('/api/auth/change-password', {
    token: signTestToken(res.body.user),
    body: { currentPassword: res.body.tempPassword, newPassword: 'NewAccount123!' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  return changed.body.token;
}

// Creates a staff account through the real endpoint and remembers it for teardown.
async function register(token, body) {
  const res = await api.post('/api/auth/register', { token, body: { email: `${tag()}@integration.test`, fullName: 'New Account', ...body } });
  if (res.body?.user?.id) ctx.userIds.push(res.body.user.id);
  return res;
}

test('an adviser created with a section and classes has them the moment they sign in', async () => {
  const res = await register(ctx.admin.token, {
    role: 'adviser',
    advisorySectionId: ctx.sectionA.id,
    classOfferingIds: [ctx.offering1.id, ctx.offering2.id],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.tempPassword);
  assert.equal(res.body.linked.section.id, ctx.sectionA.id);
  assert.match(res.body.linked.section.previousAdviser, /acct-holder/);
  assert.equal(res.body.linked.offerings.length, 2);

  const token = await firstSignIn(res);
  const sections = await api.get('/api/sections/mine', { token });
  assert.deepEqual(sections.body.sections.map((s) => s.id), [ctx.sectionA.id]);
  const offerings = await api.get('/api/class-offerings/mine', { token });
  assert.deepEqual(offerings.body.classOfferings.map((o) => o.id).sort(), [ctx.offering1.id, ctx.offering2.id].sort());

  // A feature that is assignment-gated on the server: the section's SF2.
  const sf2 = await fetch(`${server.baseUrl}/api/attendance/bulk-import/template?sectionId=${ctx.sectionA.id}&month=11&year=2026`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(sf2.status, 200);

  // The section MOVED: its previous adviser no longer has it.
  const holderSections = await api.get('/api/sections/mine', { token: ctx.holder.token });
  assert.ok(!holderSections.body.sections.some((s) => s.id === ctx.sectionA.id));
});

test('only the admin may link; a registrar can still create the bare account', async () => {
  const refused = await register(ctx.registrar.token, { role: 'adviser', advisorySectionId: ctx.sectionB.id });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /admin/i);

  const bare = await register(ctx.registrar.token, { role: 'adviser' });
  assert.equal(bare.status, 201);
  assert.equal(bare.body.linked, null);
});

test('only teaching roles can hold a section, and only in the current school year', async () => {
  const counselor = await register(ctx.admin.token, { role: 'guidance_counselor', advisorySectionId: ctx.sectionB.id });
  assert.equal(counselor.status, 400);

  const past = await register(ctx.admin.token, { role: 'adviser', advisorySectionId: ctx.pastSection.id });
  assert.equal(past.status, 400);
  assert.match(past.body.error, /current school year/);
});

test('a bad class id creates nothing at all', async () => {
  const email = `${tag()}@integration.test`;
  const res = await api.post('/api/auth/register', {
    token: ctx.admin.token,
    body: { email, fullName: 'Should Not Exist', role: 'subject_teacher', classOfferingIds: [ctx.offering1.id, 99999999] },
  });
  assert.equal(res.status, 400);
  const row = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  assert.equal(row.rowCount, 0);
  // And the valid class in the same request was not moved either.
  const owner = await pool.query('SELECT teacher_id FROM class_offerings WHERE id = $1', [ctx.offering1.id]);
  assert.notEqual(owner.rows[0].teacher_id, null);
});

test('editing an existing account can link it to a section, and the pickers list holders', async () => {
  const created = await register(ctx.admin.token, { role: 'subject_teacher' });
  const id = created.body.user.id;

  const targets = await api.get('/api/users/assignable-targets', { token: ctx.admin.token });
  assert.equal(targets.status, 200);
  const listed = targets.body.sections.find((s) => s.id === ctx.sectionB.id);
  assert.ok(listed && listed.adviser_name, 'each section is listed with its current adviser');
  assert.ok(!targets.body.sections.some((s) => s.id === ctx.pastSection.id), 'past-year sections are not offered');
  assert.equal((await api.get('/api/users/assignable-targets', { token: ctx.registrar.token })).status, 403);

  const edited = await api.patch(`/api/users/${id}`, { token: ctx.admin.token, body: { advisorySectionId: ctx.sectionB.id } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.linked.section.id, ctx.sectionB.id);
  const mine = await api.get('/api/sections/mine', { token: await firstSignIn(created) });
  assert.deepEqual(mine.body.sections.map((s) => s.id), [ctx.sectionB.id]);
});
