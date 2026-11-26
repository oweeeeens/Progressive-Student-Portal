// The registrar's access (2026-11-26, at the group's request):
//
//   - NO attendance marking. The SF2 daily register is the homeroom's, and
//     the registrar advises no section. They still READ a learner's
//     attendance, because they keep the student records.
//   - Academic Setup: view AND edit (school years, grading periods,
//     sections, subjects, class offerings), and so may link a teacher to a
//     section or class at account creation (accountAssignment.test.js).
//   - Grade reports: every section's gradesheet and every class's grade
//     report, read-only, like the admin.
//
// The principal keeps read-only Academic Setup, and an adviser keeps only
// their own section's register and gradesheet.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');

let server;
let api;
const ctx = { extraYears: [], periods: [], sections: [], subjects: [], offerings: [] };
const DAY = '2023-07-03';

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  // In the past, so its term has started and a date in it can be recorded.
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('REGACC', [
    { name: 'T1', sequenceNumber: 1, startDate: '2023-06-01', endDate: '2023-08-31' },
  ]);
  ctx.schoolYearId = schoolYearId;
  ctx.period = periods[0];
  const users = await Promise.all([
    fixtures.createStaffUser('registrar', 'reg-registrar'),
    fixtures.createStaffUser('adviser', 'reg-adviser'),
    fixtures.createStaffUser('adviser', 'reg-other-adviser'),
    fixtures.createStaffUser('subject_teacher', 'reg-teacher'),
    fixtures.createStaffUser('principal', 'reg-principal'),
  ]);
  [ctx.registrar, ctx.adviser, ctx.otherAdviser, ctx.teacher, ctx.principal] = users;
  ctx.userIds = users.map((u) => u.id);
  ctx.section = await fixtures.createTestSection({ schoolYearId, adviserId: ctx.adviser.id, label: 'reg-sec' });
  ctx.sections.push(ctx.section.id);
  const subject = await fixtures.createTestSubject('reg-subj');
  ctx.subjects.push(subject.id);
  ctx.offering = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: ctx.section.id, teacherId: ctx.teacher.id, schoolYearId });
  ctx.offerings.push(ctx.offering.id);
  ctx.learner = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'reg-learner' });
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    extraSchoolYearIds: ctx.extraYears,
    gradingPeriodIds: ctx.periods,
    userIds: ctx.userIds,
    studentIds: [ctx.learner.id],
    offeringIds: ctx.offerings,
    subjectIds: ctx.subjects,
    sectionIds: ctx.sections,
  });
});

const mark = (token) =>
  api.post('/api/attendance/daily', {
    token,
    body: { sectionId: ctx.section.id, attendanceDate: DAY, entries: [{ studentId: ctx.learner.id, status: 'present' }] },
  });

// --- Attendance ------------------------------------------------------------------

test('the registrar can no longer mark the daily register; the section\'s adviser can', async () => {
  const asRegistrar = await mark(ctx.registrar.token);
  assert.equal(asRegistrar.status, 403, JSON.stringify(asRegistrar.body));
  const asOther = await mark(ctx.otherAdviser.token);
  assert.equal(asOther.status, 403, 'another section\'s adviser still cannot');
  const asAdviser = await mark(ctx.adviser.token);
  assert.equal(asAdviser.status, 201, JSON.stringify(asAdviser.body));
});

test('the registrar still READS attendance: the section register and a learner\'s history', async () => {
  const roster = await api.get(`/api/attendance/daily?sectionId=${ctx.section.id}&date=${DAY}`, { token: ctx.registrar.token });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  const history = await api.get(`/api/students/${ctx.learner.id}/attendance/daily`, { token: ctx.registrar.token });
  assert.equal(history.status, 200, JSON.stringify(history.body));
});

test('the registrar cannot download the SF2 template to import attendance', async () => {
  const url = `${server.baseUrl}/api/attendance/bulk-import/template?sectionId=${ctx.section.id}&month=7&year=2023`;
  const asRegistrar = await fetch(url, { headers: { Authorization: `Bearer ${ctx.registrar.token}` } });
  assert.equal(asRegistrar.status, 403);
  const asAdviser = await fetch(url, { headers: { Authorization: `Bearer ${ctx.adviser.token}` } });
  assert.equal(asAdviser.status, 200);
});

// --- Academic Setup ---------------------------------------------------------------

test('the registrar edits Academic Setup: school year, period, section, subject, class offering', async () => {
  const t = ctx.registrar.token;
  const year = await api.post('/api/school-years', { token: t, body: { label: `REG-${Date.now() % 100000}`, startDate: '2018-06-01', endDate: '2019-03-31' } });
  assert.equal(year.status, 201, JSON.stringify(year.body));
  ctx.extraYears.push(year.body.schoolYear.id);

  const period = await api.post('/api/grading-periods', {
    token: t,
    body: { schoolYearId: year.body.schoolYear.id, name: 'Term 1', sequenceNumber: 1, startDate: '2018-06-01', endDate: '2018-08-31' },
  });
  assert.equal(period.status, 201, JSON.stringify(period.body));
  ctx.periods.push(period.body.gradingPeriod.id);

  const name = `REG-SEC-${Date.now() % 100000}`;
  const section = await api.post('/api/sections', { token: t, body: { schoolYearId: ctx.schoolYearId, gradeLevel: 11, strand: 'TEST', name, adviserId: ctx.otherAdviser.id } });
  assert.equal(section.status, 201, JSON.stringify(section.body));
  ctx.sections.push(section.body.section.id);
  const renamed = await api.put(`/api/sections/${section.body.section.id}`, {
    token: t,
    body: { schoolYearId: ctx.schoolYearId, gradeLevel: 11, strand: 'TEST', name: `${name}-B`, adviserId: ctx.otherAdviser.id },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.section.name, `${name}-B`);

  const subject = await api.post('/api/subjects', { token: t, body: { name: `REG-SUBJ-${Date.now() % 100000}`, gradeLevel: 11 } });
  assert.equal(subject.status, 201, JSON.stringify(subject.body));
  ctx.subjects.push(subject.body.subject.id);

  const offering = await api.post('/api/class-offerings', {
    token: t,
    body: { subjectId: subject.body.subject.id, sectionId: section.body.section.id, teacherId: ctx.teacher.id, schoolYearId: ctx.schoolYearId },
  });
  assert.equal(offering.status, 201, JSON.stringify(offering.body));
  ctx.offerings.push(offering.body.classOffering.id);

  // Deactivate what has no history, as the admin could.
  assert.equal((await api.post(`/api/class-offerings/${offering.body.classOffering.id}/deactivate`, { token: t })).status, 200);
  assert.equal((await api.post(`/api/subjects/${subject.body.subject.id}/deactivate`, { token: t })).status, 200);

  // The admin lists are open to them.
  for (const url of ['/api/school-years', '/api/sections/admin', '/api/subjects/admin', '/api/class-offerings/admin', `/api/grading-periods/admin?schoolYearId=${ctx.schoolYearId}`]) {
    assert.equal((await api.get(url, { token: t })).status, 200, url);
  }
});

test('the principal still only reads Academic Setup', async () => {
  const p = ctx.principal.token;
  assert.equal((await api.get('/api/sections/admin', { token: p })).status, 200);
  const refused = await api.post('/api/sections', { token: p, body: { schoolYearId: ctx.schoolYearId, gradeLevel: 11, strand: 'TEST', name: 'REG-NOPE', adviserId: ctx.otherAdviser.id } });
  assert.equal(refused.status, 403);
  assert.equal((await api.post('/api/subjects', { token: p, body: { name: 'REG-NOPE' } })).status, 403);
});

test('an adviser or teacher still cannot change Academic Setup', async () => {
  for (const who of ['adviser', 'teacher']) {
    const res = await api.post('/api/subjects', { token: ctx[who].token, body: { name: `REG-NO-${who}` } });
    assert.equal(res.status, 403, who);
  }
});

// --- Grade reports ----------------------------------------------------------------

test('the registrar reads any section\'s gradesheet and any class\'s grade report', async () => {
  const gs = await api.get(`/api/reports/gradesheet?sectionId=${ctx.section.id}`, { token: ctx.registrar.token });
  assert.equal(gs.status, 200, JSON.stringify(gs.body));
  const cls = await api.get(`/api/reports/class-grades?classOfferingId=${ctx.offering.id}`, { token: ctx.registrar.token });
  assert.equal(cls.status, 200, JSON.stringify(cls.body));
  // Another adviser and another teacher still cannot.
  assert.equal((await api.get(`/api/reports/gradesheet?sectionId=${ctx.section.id}`, { token: ctx.otherAdviser.token })).status, 403);
});

test('the class report picker lists every current class for the registrar, but not for a teacher', async () => {
  const asRegistrar = await api.get('/api/class-offerings/current', { token: ctx.registrar.token });
  assert.equal(asRegistrar.status, 200);
  assert.ok(Array.isArray(asRegistrar.body.classOfferings));
  assert.equal((await api.get('/api/class-offerings/current', { token: ctx.teacher.token })).status, 403);
  // And it grants nothing in the Class Record: the registrar records no scores.
  const recordable = await api.get('/api/class-offerings/recordable', { token: ctx.registrar.token });
  assert.deepEqual(recordable.body.classOfferings, []);
});
