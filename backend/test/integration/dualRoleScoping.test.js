// A teacher who BOTH advises one section and teaches a subject to another.
//
// This is how the school actually staffs its timetable, and until now the
// codebase could not represent it. Read scope was a switch on the role
// column with a return in every branch, so exactly one predicate could ever
// apply — while every WRITE guard was already assignment-based. The result
// was that such a teacher could submit a student's grade and then not be
// allowed to open that student's record: 404 on the detail page, no
// attendance history, missing from the roster entirely.
//
// These tests exist because the fix widens read access, and widening read
// access on a system holding minors' records is exactly the change that
// needs a test standing behind it afterwards. Half of them assert the new
// reach; the other half assert that fail-closed still holds.
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

  const { schoolYearId } = await fixtures.createSchoolYearWithPeriods('DUAL', [
    { name: 'Q1', sequenceNumber: 1, startDate: '2039-06-01', endDate: '2039-08-31' },
  ]);

  // The dual-hat user carries the role label `adviser`, deliberately: the
  // point is that the label must stop deciding anything.
  const [dualHat, otherAdviser, plainTeacher, principal] = await Promise.all([
    fixtures.createStaffUser('adviser', 'dual-hat'),
    fixtures.createStaffUser('adviser', 'dual-other'),
    fixtures.createStaffUser('subject_teacher', 'dual-teacher'),
    fixtures.createStaffUser('principal', 'dual-principal'),
  ]);

  // advisedSection: they are its adviser_id and teach nothing in it.
  // taughtSection: they teach one subject into it and advise nothing in it.
  const advisedSection = await fixtures.createTestSection({ schoolYearId, adviserId: dualHat.id, label: 'dual-advised' });
  const taughtSection = await fixtures.createTestSection({ schoolYearId, adviserId: otherAdviser.id, label: 'dual-taught' });

  const subject = await fixtures.createTestSubject('dual-subject');
  const offering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: taughtSection.id,
    teacherId: dualHat.id,
    schoolYearId,
  });

  const [advisee, taughtStudent] = await Promise.all([
    fixtures.createTestStudent({ sectionId: advisedSection.id, label: 'dual-advisee' }),
    fixtures.createTestStudent({ sectionId: taughtSection.id, label: 'dual-taught-student' }),
  ]);

  ctx = {
    schoolYearId,
    dualHat,
    otherAdviser,
    plainTeacher,
    principal,
    advisedSection,
    taughtSection,
    subjectId: subject.id,
    offeringId: offering.id,
    adviseeId: advisee.id,
    taughtStudentId: taughtStudent.id,
  };
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    studentIds: [ctx.adviseeId, ctx.taughtStudentId],
    // Offerings before sections and subjects: both are ON DELETE RESTRICT,
    // so the offering has to go first or neither can be removed.
    offeringIds: [ctx.offeringId],
    sectionIds: [ctx.advisedSection.id, ctx.taughtSection.id],
    subjectIds: [ctx.subjectId],
    userIds: [ctx.dualHat.id, ctx.otherAdviser.id, ctx.plainTeacher.id, ctx.principal.id],
  });
});

test('reaches students in the section they advise', async () => {
  const res = await api.get(`/api/students/${ctx.adviseeId}`, { token: ctx.dualHat.token });
  assert.equal(res.status, 200);
});

test('reaches students in a section they only teach into', async () => {
  // The exact request that used to 404 while the same user was permitted to
  // submit that student's grades.
  const res = await api.get(`/api/students/${ctx.taughtStudentId}`, { token: ctx.dualHat.token });
  assert.equal(res.status, 200);
});

test('both kinds of student appear in one roster', async () => {
  const res = await api.get('/api/students?pageSize=100', { token: ctx.dualHat.token });
  assert.equal(res.status, 200);
  const ids = res.body.students.map((s) => s.id);
  assert.ok(ids.includes(ctx.adviseeId), 'advisee missing from roster');
  assert.ok(ids.includes(ctx.taughtStudentId), 'taught student missing from roster');
});

test('an unrelated adviser still cannot reach either student', async () => {
  // Widening read scope must not have widened it for everyone.
  const res = await api.get(`/api/students/${ctx.adviseeId}`, { token: ctx.otherAdviser.token });
  assert.equal(res.status, 404);
});

test('a teacher who holds no assignment at all sees nobody', async () => {
  // The fail-closed default. `plainTeacher` advises nothing and teaches
  // nothing, so no predicate matches and the scope clause must be FALSE.
  const res = await api.get('/api/students?pageSize=100', { token: ctx.plainTeacher.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.students, []);
});

test('academic progress refuses a section they teach but do not advise', async () => {
  // Reading a student is not the same as reading a whole section's risk
  // profile — that stays with the adviser and the school-wide roles.
  const res = await api.get(`/api/academic-progress?sectionId=${ctx.taughtSection.id}`, {
    token: ctx.dualHat.token,
  });
  assert.equal(res.status, 403);
});

test('academic progress with no section is refused, not answered school-wide', async () => {
  // Without a section filter the underlying query is unrestricted. The
  // guard used to ask `role === 'adviser'`, so anyone advising a section
  // under a different role label walked straight past it.
  const res = await api.get('/api/academic-progress', { token: ctx.dualHat.token });
  assert.equal(res.status, 400);
});

test('the principal reads Academic Setup but cannot change it', async () => {
  const { token } = ctx.principal;
  for (const path of ['/api/sections/admin', '/api/subjects/admin', '/api/class-offerings/admin']) {
    const read = await api.get(`${path}?page=1&pageSize=5`, { token });
    assert.equal(read.status, 200, `${path} should be readable`);
  }
  assert.equal((await api.get('/api/school-years', { token })).status, 200);

  const write = await api.post('/api/subjects', {
    token,
    body: { name: 'Principal should not create this' },
  });
  assert.equal(write.status, 403);
});
