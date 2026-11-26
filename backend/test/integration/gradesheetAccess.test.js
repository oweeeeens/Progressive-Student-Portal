// Who may open an adviser gradesheet (2026-11-26, at the group's request):
//
//   every section     admin, registrar, principal, guidance counselor
//   their sections    an adviser (the section they advise) and a subject
//                     teacher (a section they teach an active class in)
//   never             a learner, or anyone for a section they have nothing to do with
//
// GET /api/reports/gradesheet/sections lists exactly what each may open, and
// the gradesheet itself refuses anything else.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

let server;
let api;
const ctx = {};

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  // The CURRENT school year: the picker lists current-year sections.
  ctx.yearId = (await pool.query('SELECT id FROM school_years WHERE is_current = TRUE LIMIT 1')).rows[0].id;
  const users = await Promise.all([
    fixtures.createStaffUser('principal', 'gsa-principal'),
    fixtures.createStaffUser('guidance_counselor', 'gsa-guidance'),
    fixtures.createStaffUser('adviser', 'gsa-adviser-a'),
    fixtures.createStaffUser('adviser', 'gsa-adviser-b'),
    fixtures.createStaffUser('subject_teacher', 'gsa-teacher'),
    fixtures.createStaffUser('student', 'gsa-student'),
  ]);
  [ctx.principal, ctx.guidance, ctx.adviserA, ctx.adviserB, ctx.teacher, ctx.student] = users;
  ctx.userIds = users.map((u) => u.id);
  ctx.sectionA = await fixtures.createTestSection({ schoolYearId: ctx.yearId, adviserId: ctx.adviserA.id, label: 'gsa-a' });
  ctx.sectionB = await fixtures.createTestSection({ schoolYearId: ctx.yearId, adviserId: ctx.adviserB.id, label: 'gsa-b' });
  ctx.sectionC = await fixtures.createTestSection({ schoolYearId: ctx.yearId, adviserId: ctx.adviserB.id, label: 'gsa-c' });
  const subj = await fixtures.createTestSubject('gsa-subj');
  const subj2 = await fixtures.createTestSubject('gsa-subj2');
  ctx.subjectIds = [subj.id, subj2.id];
  // The teacher teaches into A (active) and into C, but that class is deactivated.
  ctx.classA = await fixtures.createTestOffering({ subjectId: subj.id, sectionId: ctx.sectionA.id, teacherId: ctx.teacher.id, schoolYearId: ctx.yearId });
  ctx.classC = await fixtures.createTestOffering({ subjectId: subj2.id, sectionId: ctx.sectionC.id, teacherId: ctx.teacher.id, schoolYearId: ctx.yearId });
  await pool.query('UPDATE class_offerings SET is_active = FALSE WHERE id = $1', [ctx.classC.id]);
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.yearId,
    ownSchoolYear: false,
    userIds: ctx.userIds,
    offeringIds: [ctx.classA.id, ctx.classC.id],
    subjectIds: ctx.subjectIds,
    sectionIds: [ctx.sectionA.id, ctx.sectionB.id, ctx.sectionC.id],
  });
});

const open = (who, section) => api.get(`/api/reports/gradesheet?sectionId=${section.id}`, { token: ctx[who].token });
const listed = async (who) => (await api.get('/api/reports/gradesheet/sections', { token: ctx[who].token })).body.sections.map((s) => s.id);

test('the principal and the guidance counselor open every section\'s gradesheet', async () => {
  for (const who of ['principal', 'guidance']) {
    for (const section of [ctx.sectionA, ctx.sectionB, ctx.sectionC]) {
      assert.equal((await open(who, section)).status, 200, `${who} ${section.name}`);
    }
    const ids = await listed(who);
    for (const section of [ctx.sectionA, ctx.sectionB, ctx.sectionC]) assert.ok(ids.includes(section.id), `${who} picker lists ${section.name}`);
  }
});

test('a subject teacher opens only the sections they teach an active class in', async () => {
  assert.equal((await open('teacher', ctx.sectionA)).status, 200);
  assert.equal((await open('teacher', ctx.sectionB)).status, 403, 'teaches nothing there');
  assert.equal((await open('teacher', ctx.sectionC)).status, 403, 'their class there is deactivated');
  const ids = await listed('teacher');
  assert.ok(ids.includes(ctx.sectionA.id));
  assert.ok(!ids.includes(ctx.sectionB.id) && !ids.includes(ctx.sectionC.id));
});

test('an adviser opens only the section they advise', async () => {
  assert.equal((await open('adviserA', ctx.sectionA)).status, 200);
  assert.equal((await open('adviserA', ctx.sectionB)).status, 403);
  const ids = await listed('adviserA');
  assert.ok(ids.includes(ctx.sectionA.id) && !ids.includes(ctx.sectionB.id));
  const mine = (await api.get('/api/reports/gradesheet/sections', { token: ctx.adviserA.token })).body.sections.find((s) => s.id === ctx.sectionA.id);
  assert.equal(mine.advises, true, 'their own section is marked, so the picker opens on it');
});

test('a learner opens no gradesheet', async () => {
  assert.equal((await open('student', ctx.sectionA)).status, 403);
  assert.deepEqual(await listed('student'), []);
});
