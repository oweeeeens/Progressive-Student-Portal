// Enrolled student list (GET /api/reports/enrolled-students) — panel item 4.
// The registrar's list of this school year's learners, filterable by grade
// level, section and strand, with a count. The fixture's sections live in the
// real CURRENT school year (the list is current-year by definition) under a
// unique strand, so filtering by that strand isolates them from demo data.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');
const sectionModel = require('../../models/sectionModel');

let server;
let api;
const ctx = {};
const STRAND = `T${Date.now().toString().slice(-6)}`;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  ctx.yearId = (await pool.query('SELECT id FROM school_years WHERE is_current = TRUE LIMIT 1')).rows[0].id;
  const users = await Promise.all([
    fixtures.createStaffUser('admin', 'enl-admin'),
    fixtures.createStaffUser('registrar', 'enl-registrar'),
    fixtures.createStaffUser('adviser', 'enl-adviser'),
    fixtures.createStaffUser('subject_teacher', 'enl-teacher'),
    fixtures.createStaffUser('student', 'enl-student'),
  ]);
  [ctx.admin, ctx.registrar, ctx.adviser, ctx.teacher, ctx.studentUser] = users;
  ctx.userIds = users.map((u) => u.id);

  // Two sections of the unique strand: Grade 11 and Grade 12.
  const mk = (gradeLevel, name) => sectionModel.createSection({ schoolYearId: ctx.yearId, gradeLevel, strand: STRAND, name: `${name}-${STRAND}`, adviserId: ctx.adviser.id });
  ctx.g11 = await mk(11, 'enl-g11');
  ctx.g12 = await mk(12, 'enl-g12');
  const subject = await fixtures.createTestSubject('enl-subject');
  ctx.subjectId = subject.id;
  ctx.offering = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: ctx.g11.id, teacherId: ctx.teacher.id, schoolYearId: ctx.yearId });

  ctx.s1 = await fixtures.createTestStudent({ sectionId: ctx.g11.id, label: 'enl-s1' });
  ctx.s2 = await fixtures.createTestStudent({ sectionId: ctx.g11.id, label: 'enl-s2' });
  ctx.s3 = await fixtures.createTestStudent({ sectionId: ctx.g12.id, label: 'enl-s3' });
  ctx.gone = await fixtures.createTestStudent({ sectionId: ctx.g11.id, label: 'enl-gone' });
  ctx.dropped = await fixtures.createTestStudent({ sectionId: ctx.g11.id, label: 'enl-dropped' });
  await pool.query("UPDATE students SET enrollment_status = 'dropped' WHERE id = $1", [ctx.dropped.id]);
  await pool.query('UPDATE students SET sex = $1 WHERE id = ANY($2::int[])', ['F', [ctx.s1.id, ctx.s3.id]]);
  await pool.query('UPDATE students SET sex = $1 WHERE id = $2', ['M', ctx.s2.id]);
  await pool.query('UPDATE students SET is_active = FALSE WHERE id = $1', [ctx.gone.id]);
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.yearId,
    ownSchoolYear: false,
    userIds: ctx.userIds,
    studentIds: [ctx.s1.id, ctx.s2.id, ctx.s3.id, ctx.gone.id, ctx.dropped.id],
    offeringIds: [ctx.offering.id],
    subjectIds: [ctx.subjectId],
    sectionIds: [ctx.g11.id, ctx.g12.id],
  });
});

const list = (token, query = '') => api.get(`/api/reports/enrolled-students?strand=${STRAND}${query}`, { token });

test('the registrar sees the strand\'s active learners, counted per section and by sex', async () => {
  const res = await list(ctx.registrar.token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.students.map((s) => s.id).sort();
  assert.deepEqual(ids, [ctx.s1.id, ctx.s2.id, ctx.s3.id].sort(), 'an inactive learner is not on the list');
  assert.equal(res.body.total, 3);
  assert.deepEqual(res.body.bySex, { M: 1, F: 2, unrecorded: 0 });
  const counts = Object.fromEntries(res.body.bySection.map((s) => [s.sectionId, s.count]));
  assert.deepEqual(counts, { [ctx.g11.id]: 2, [ctx.g12.id]: 1 });
  assert.ok(res.body.options.strands.includes(STRAND));
  // Subjects enrolled comes from class_enrollments.
  assert.equal(res.body.students.find((s) => s.id === ctx.s1.id).subjectCount, 1);
  assert.equal(res.body.students.find((s) => s.id === ctx.s3.id).subjectCount, 0);
});

test('filters combine: grade level, and section', async () => {
  const g12 = await list(ctx.registrar.token, '&gradeLevel=12');
  assert.deepEqual(g12.body.students.map((s) => s.id), [ctx.s3.id]);
  assert.deepEqual(g12.body.bySection.map((s) => s.sectionId), [ctx.g12.id]);
  const sec = await list(ctx.registrar.token, `&sectionId=${ctx.g11.id}`);
  assert.equal(sec.body.total, 2);
  const none = await list(ctx.registrar.token, `&sectionId=${ctx.g11.id}&gradeLevel=12`);
  assert.equal(none.body.total, 0, 'a section of grade 11 filtered to grade 12 has no one');
  assert.equal((await list(ctx.registrar.token, '&gradeLevel=10')).status, 400);
});

test('a dropped learner is not on the ENROLLED list, but can be asked for', async () => {
  const byDefault = await list(ctx.registrar.token);
  assert.ok(!byDefault.body.students.some((s) => s.id === ctx.dropped.id), 'enrolled only, by default');
  const all = await list(ctx.registrar.token, '&status=all');
  assert.equal(all.body.total, 4);
  assert.ok(all.body.students.some((s) => s.id === ctx.dropped.id && s.enrollmentStatus === 'dropped'));
  const droppedOnly = await list(ctx.registrar.token, '&status=dropped');
  assert.deepEqual(droppedOnly.body.students.map((s) => s.id), [ctx.dropped.id]);
  assert.equal((await list(ctx.registrar.token, '&status=bogus')).status, 400);
});

test('only the registrar and the admin can see it', async () => {
  assert.equal((await list(ctx.admin.token)).status, 200);
  for (const who of ['adviser', 'teacher', 'studentUser']) {
    assert.equal((await list(ctx[who].token)).status, 403, who);
  }
});

test('exports: a PDF, and a workbook with the learners and the count per section', async () => {
  const get = async (fmt) => {
    const res = await fetch(`${server.baseUrl}/api/reports/enrolled-students/export/${fmt}?strand=${STRAND}`, { headers: { Authorization: `Bearer ${ctx.registrar.token}` } });
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  };
  const pdf = await get('pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  const xlsx = await get('excel');
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Report Info', 'Learners', 'By Section']);
  assert.equal(wb.getWorksheet('Learners').rowCount, 1 + 3);
  const bySection = wb.getWorksheet('By Section');
  const last = bySection.getRow(bySection.rowCount);
  assert.deepEqual([last.getCell(2).value, last.getCell(4).value], ['Total', 3]);
});
