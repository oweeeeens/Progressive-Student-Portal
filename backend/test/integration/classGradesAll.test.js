// Class Grade Report → "All my classes" (GET /api/reports/class-grades/all):
// panel item 4b asks for "students in EACH of the teacher's own class
// offerings", so a teacher can see and export all of them at once. The
// fixture lives in the real CURRENT school year, which is what the teacher's
// class list covers.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

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
  ctx.yearId = (await pool.query('SELECT id FROM school_years WHERE is_current = TRUE LIMIT 1')).rows[0].id;
  const users = await Promise.all([
    fixtures.createStaffUser('admin', 'cga-admin'),
    fixtures.createStaffUser('subject_teacher', 'cga-teacher'),
    fixtures.createStaffUser('subject_teacher', 'cga-teacher-b'),
    fixtures.createStaffUser('adviser', 'cga-adviser'),
    fixtures.createStaffUser('registrar', 'cga-registrar'),
  ]);
  [ctx.admin, ctx.teacher, ctx.teacherB, ctx.adviser, ctx.registrar] = users;
  ctx.userIds = users.map((u) => u.id);
  ctx.section = await fixtures.createTestSection({ schoolYearId: ctx.yearId, adviserId: ctx.adviser.id, label: 'cga-section' });
  ctx.subjectIds = [];
  ctx.offerings = [];
  for (const [label, teacher] of [['cga-math', ctx.teacher], ['cga-science', ctx.teacher], ['cga-english', ctx.teacherB]]) {
    const subject = await fixtures.createTestSubject(label);
    ctx.subjectIds.push(subject.id);
    ctx.offerings.push(await fixtures.createTestOffering({ subjectId: subject.id, sectionId: ctx.section.id, teacherId: teacher.id, schoolYearId: ctx.yearId }));
  }
  [ctx.math, ctx.science, ctx.english] = ctx.offerings;
  ctx.s1 = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'cga-s1' });
  ctx.s2 = await fixtures.createTestStudent({ sectionId: ctx.section.id, label: 'cga-s2' });
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.yearId,
    ownSchoolYear: false,
    userIds: ctx.userIds,
    studentIds: [ctx.s1.id, ctx.s2.id],
    offeringIds: ctx.offerings.map((o) => o.id),
    subjectIds: ctx.subjectIds,
    sectionIds: [ctx.section.id],
  });
});

const all = (token, q = '') => api.get(`/api/reports/class-grades/all${q}`, { token });

test('a teacher gets every class they teach, each with its enrolled learners — and nobody else\'s', async () => {
  const res = await all(ctx.teacher.token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.classes.map((c) => c.offering.id).sort(), [ctx.math.id, ctx.science.id].sort());
  for (const c of res.body.classes) {
    assert.deepEqual(c.rows.map((r) => r.studentId).sort(), [ctx.s1.id, ctx.s2.id].sort(), 'the enrolled learners');
    assert.ok(c.periods.length > 0);
  }
  assert.match(res.body.scopeLabel, /Classes taught by/);

  const other = await all(ctx.teacherB.token);
  assert.deepEqual(other.body.classes.map((c) => c.offering.id), [ctx.english.id]);
});

test('someone teaching nothing gets an empty list, never another teacher\'s classes', async () => {
  const res = await all(ctx.adviser.token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.classes, []);
  // The registrar is not "teaching nothing" here: since 2026-11-26 they read
  // every class's report, like the admin (see the admin test below).
});

test('the admin sees every class, and can narrow to one section', async () => {
  const res = await all(ctx.admin.token, `?sectionId=${ctx.section.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.classes.map((c) => c.offering.id).sort(), ctx.offerings.map((o) => o.id).sort());
  const everything = await all(ctx.admin.token);
  assert.ok(ctx.offerings.every((o) => everything.body.classes.some((c) => c.offering.id === o.id)));
  assert.equal((await all(ctx.admin.token, '?sectionId=abc')).status, 400);
});

test('exports: one PDF, and a workbook with a sheet per class', async () => {
  const get = async (fmt) => {
    const res = await fetch(`${server.baseUrl}/api/reports/class-grades/all/export/${fmt}`, { headers: { Authorization: `Bearer ${ctx.teacher.token}` } });
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  };
  const pdf = await get('pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  const xlsx = await get('excel');
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buffer);
  assert.equal(wb.worksheets.length, 3, 'Report Info + one sheet per class');
  assert.equal(wb.worksheets[0].name, 'Report Info');
  for (const sheet of wb.worksheets.slice(1)) assert.equal(sheet.rowCount, 1 + 2, `${sheet.name}: header + 2 learners`);
});
