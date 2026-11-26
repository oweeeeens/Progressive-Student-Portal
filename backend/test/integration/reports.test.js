// The panel's reports (panel revision, 2026-11-18): figures, access, and the
// PDF / Excel exports, against grades made through the real approval chain.
//
// The fixture is built so each rule has something to catch:
//   Subject X (whole year, section A):  T1 finalized for both learners,
//                                       T2 only SUBMITTED for a1
//   Subject Y (Term 2 only, section A): T2 only VERIFIED for a2
//   Subject Z (section B):              another adviser's and teacher's class
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const { submitGrades } = require('./helpers/classRecord');
const fixtures = require('./helpers/fixtures');

let server;
let api;
const ctx = {};

async function grade(offering, period, entries) {
  const res = await submitGrades(api, { token: ctx.teacher.token, body: { classOfferingId: offering.id, gradingPeriodId: period.id, entries } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.grades.map((g) => g.id);
}

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('RPT', [
    // In the PAST, so both terms have started: an empty cell then means "not
    // submitted", which is what these tests count (a term that has not
    // started is counted apart — see panelHardening.test.js).
    { name: 'T1', sequenceNumber: 1, startDate: '2021-06-01', endDate: '2021-08-31' },
    { name: 'T2', sequenceNumber: 2, startDate: '2021-09-01', endDate: '2021-11-30' },
  ]);
  ctx.schoolYearId = schoolYearId;
  [ctx.t1, ctx.t2] = periods;

  const users = await Promise.all([
    fixtures.createStaffUser('admin', 'rpt-admin'),
    fixtures.createStaffUser('registrar', 'rpt-registrar'),
    fixtures.createStaffUser('principal', 'rpt-principal'),
    fixtures.createStaffUser('adviser', 'rpt-adviser-a'),
    fixtures.createStaffUser('adviser', 'rpt-adviser-b'),
    fixtures.createStaffUser('subject_teacher', 'rpt-teacher'),
    fixtures.createStaffUser('subject_teacher', 'rpt-teacher-b'),
    fixtures.createStaffUser('student', 'rpt-student'),
  ]);
  [ctx.admin, ctx.registrar, ctx.principal, ctx.adviserA, ctx.adviserB, ctx.teacher, ctx.teacherB, ctx.studentUser] = users;
  ctx.userIds = users.map((u) => u.id);

  ctx.sectionA = await fixtures.createTestSection({ schoolYearId, adviserId: ctx.adviserA.id, label: 'rpt-a' });
  ctx.sectionB = await fixtures.createTestSection({ schoolYearId, adviserId: ctx.adviserB.id, label: 'rpt-b' });
  const subjX = await fixtures.createTestSubject('rpt-x');
  const subjY = await fixtures.createTestSubject('rpt-y');
  const subjZ = await fixtures.createTestSubject('rpt-z');
  ctx.subjectIds = [subjX.id, subjY.id, subjZ.id];
  ctx.x = await fixtures.createTestOffering({ subjectId: subjX.id, sectionId: ctx.sectionA.id, teacherId: ctx.teacher.id, schoolYearId });
  ctx.y = await fixtures.createTestOffering({ subjectId: subjY.id, sectionId: ctx.sectionA.id, teacherId: ctx.teacher.id, schoolYearId, term: 'term2' });
  ctx.z = await fixtures.createTestOffering({ subjectId: subjZ.id, sectionId: ctx.sectionB.id, teacherId: ctx.teacherB.id, schoolYearId });
  ctx.a1 = await fixtures.createTestStudent({ sectionId: ctx.sectionA.id, label: 'rpt-a1' });
  ctx.a2 = await fixtures.createTestStudent({ sectionId: ctx.sectionA.id, label: 'rpt-a2' });
  ctx.b1 = await fixtures.createTestStudent({ sectionId: ctx.sectionB.id, label: 'rpt-b1' });

  // X, Term 1: both learners through the whole chain to FINALIZED.
  const x1 = await grade(ctx.x, ctx.t1, [{ studentId: ctx.a1.id, gradeValue: 85 }, { studentId: ctx.a2.id, gradeValue: 72 }]);
  assert.equal((await api.post('/api/grades/verify', { token: ctx.principal.token, body: { gradeIds: x1, gradingPeriodId: ctx.t1.id } })).status, 200);
  assert.equal((await api.post('/api/grades/finalize', { token: ctx.adviserA.token, body: { sectionId: ctx.sectionA.id, gradingPeriodId: ctx.t1.id } })).status, 200);
  // X, Term 2: a1 only SUBMITTED.
  await grade(ctx.x, ctx.t2, [{ studentId: ctx.a1.id, gradeValue: 90 }]);
  // Y, Term 2: a2 VERIFIED but not finalized.
  const y2 = await grade(ctx.y, ctx.t2, [{ studentId: ctx.a2.id, gradeValue: 88 }]);
  assert.equal((await api.post('/api/grades/verify', { token: ctx.principal.token, body: { gradeIds: y2, gradingPeriodId: ctx.t2.id } })).status, 200);
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: ctx.userIds,
    studentIds: [ctx.a1.id, ctx.a2.id, ctx.b1.id],
    offeringIds: [ctx.x.id, ctx.y.id, ctx.z.id],
    subjectIds: ctx.subjectIds,
    sectionIds: [ctx.sectionA.id, ctx.sectionB.id],
  });
});

// A binary download through the real server.
async function download(path, token) {
  const res = await fetch(`${server.baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), buffer: Buffer.from(await res.arrayBuffer()) };
}

// --- Adviser gradesheet --------------------------------------------------------

test('gradesheet: finalized grades only, one table per period, Term-2-only subject only in Term 2', async () => {
  const res = await api.get(`/api/reports/gradesheet?sectionId=${ctx.sectionA.id}`, { token: ctx.adviserA.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { periods, section, studentCount } = res.body;
  assert.equal(section.name, ctx.sectionA.name);
  assert.equal(studentCount, 2);
  const [p1, p2] = periods;

  assert.deepEqual(p1.subjects.map((s) => s.offeringId), [ctx.x.id], 'Y runs in Term 2 only');
  const row = (p, s) => p.rows.find((r) => r.studentId === s.id);
  assert.deepEqual(row(p1, ctx.a1).grades, [85]);
  assert.deepEqual(row(p1, ctx.a2).grades, [72]);
  assert.equal(row(p1, ctx.a1).average, 85);
  assert.equal(p1.finalizedCells, 2);
  assert.equal(p1.cellCount, 2);

  assert.deepEqual(p2.subjects.map((s) => s.offeringId).sort(), [ctx.x.id, ctx.y.id].sort());
  // Submitted (a1, X) and verified (a2, Y) grades are NOT on the gradesheet.
  assert.ok(row(p2, ctx.a1).grades.every((g) => g === null));
  assert.ok(row(p2, ctx.a2).grades.every((g) => g === null));
  assert.equal(p2.finalizedCells, 0);
  assert.equal(row(p2, ctx.a1).average, null);
  // Section B's learner is not on section A's sheet.
  assert.ok(!p1.rows.some((r) => r.studentId === ctx.b1.id));
});

test('gradesheet: the section\'s own adviser, the admin or the registrar', async () => {
  const url = `/api/reports/gradesheet?sectionId=${ctx.sectionA.id}`;
  assert.equal((await api.get(url, { token: ctx.admin.token })).status, 200);
  // The registrar reads every section's gradesheet (2026-11-26), and exports it.
  assert.equal((await api.get(url, { token: ctx.registrar.token })).status, 200);
  assert.equal((await download(`/api/reports/gradesheet/export/excel?sectionId=${ctx.sectionA.id}`, ctx.registrar.token)).status, 200);
  for (const who of ['adviserB', 'teacher', 'principal', 'studentUser']) {
    assert.equal((await api.get(url, { token: ctx[who].token })).status, 403, who);
  }
  assert.equal((await api.get('/api/reports/gradesheet', { token: ctx.adviserA.token })).status, 400);
  assert.equal((await api.get('/api/reports/gradesheet?sectionId=99999999', { token: ctx.admin.token })).status, 404);
  // The exports are guarded the same way.
  assert.equal((await download(`/api/reports/gradesheet/export/pdf?sectionId=${ctx.sectionA.id}`, ctx.adviserB.token)).status, 403);
});

test('gradesheet exports: a PDF, and a workbook whose cells match the report', async () => {
  const pdf = await download(`/api/reports/gradesheet/export/pdf?sectionId=${ctx.sectionA.id}`, ctx.adviserA.token);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.type, 'application/pdf');
  assert.match(pdf.disposition, /attachment; filename="Gradesheet-.*\.pdf"/);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');

  const xlsx = await download(`/api/reports/gradesheet/export/excel?sectionId=${ctx.sectionA.id}`, ctx.adviserA.token);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.type, /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Report Info', 'T1', 'T2', 'Subjects']);
  const t1 = wb.getWorksheet('T1');
  const header = t1.getRow(1).values.slice(1);
  const lrnCol = header.indexOf('LRN') + 1;
  const xCol = header.findIndex((h) => /rpt-x/.test(String(h))) + 1;
  const avgCol = header.indexOf('Average (finalized)') + 1;
  const a1Row = [2, 3].map((r) => t1.getRow(r)).find((r) => r.getCell(lrnCol).value === ctx.a1.lrn);
  assert.equal(a1Row.getCell(xCol).value, 85);
  assert.equal(a1Row.getCell(avgCol).value, 85);
  // An unfinalized grade is an EMPTY cell in the workbook, never a 0.
  const t2 = wb.getWorksheet('T2');
  const t2Header = t2.getRow(1).values.slice(1);
  const t2a1 = [2, 3].map((r) => t2.getRow(r)).find((r) => r.getCell(t2Header.indexOf('LRN') + 1).value === ctx.a1.lrn);
  assert.equal(t2a1.getCell(t2Header.findIndex((h) => /rpt-x/.test(String(h))) + 1).value, null);
});

// --- Subject teacher's class grade report ----------------------------------------

test('class grades: enrolled learners × the periods the class runs, each grade with its stage', async () => {
  const res = await api.get(`/api/reports/class-grades?classOfferingId=${ctx.x.id}`, { token: ctx.teacher.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.periods.map((p) => p.periodId), [ctx.t1.id, ctx.t2.id]);
  const row = (s) => res.body.rows.find((r) => r.studentId === s.id);
  assert.deepEqual(row(ctx.a1).cells, [{ value: 85, status: 'finalized' }, { value: 90, status: 'submitted' }]);
  assert.deepEqual(row(ctx.a2).cells, [{ value: 72, status: 'finalized' }, null]);
  assert.equal(row(ctx.a1).finalizedAverage, 85);
  assert.deepEqual(res.body.statusCounts, { submitted: 1, principal_verified: 0, finalized: 2, rejected: 0, none: 1, notStarted: 0 });
  assert.ok(!res.body.rows.some((r) => r.studentId === ctx.b1.id), 'only learners enrolled in the class');

  const yRes = await api.get(`/api/reports/class-grades?classOfferingId=${ctx.y.id}`, { token: ctx.teacher.token });
  assert.deepEqual(yRes.body.periods.map((p) => p.periodId), [ctx.t2.id], 'a Term 2 class has only Term 2');
  assert.deepEqual(yRes.body.rows.find((r) => r.studentId === ctx.a2.id).cells, [{ value: 88, status: 'principal_verified' }]);
});

test('class grades: the class\'s own teacher, the admin or the registrar', async () => {
  const url = `/api/reports/class-grades?classOfferingId=${ctx.x.id}`;
  assert.equal((await api.get(url, { token: ctx.admin.token })).status, 200);
  // The registrar reads every class's report (2026-11-26), and exports it.
  assert.equal((await api.get(url, { token: ctx.registrar.token })).status, 200);
  assert.equal((await download(`/api/reports/class-grades/export/pdf?classOfferingId=${ctx.x.id}`, ctx.registrar.token)).status, 200);
  for (const who of ['teacherB', 'adviserA', 'principal', 'studentUser']) {
    assert.equal((await api.get(url, { token: ctx[who].token })).status, 403, who);
  }
  assert.equal((await api.get('/api/reports/class-grades?classOfferingId=abc', { token: ctx.teacher.token })).status, 400);
});

test('class grades exports: a PDF, and a workbook with grade and status per period', async () => {
  const pdf = await download(`/api/reports/class-grades/export/pdf?classOfferingId=${ctx.x.id}`, ctx.teacher.token);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  const xlsx = await download(`/api/reports/class-grades/export/excel?classOfferingId=${ctx.x.id}`, ctx.teacher.token);
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buffer);
  const sheet = wb.getWorksheet('Grades');
  const header = sheet.getRow(1).values.slice(1);
  assert.deepEqual(header, ['LRN', 'Learner', 'T1 grade', 'T1 status', 'T2 grade', 'T2 status', 'Finalized average']);
  const a1 = [2, 3].map((r) => sheet.getRow(r)).find((r) => r.getCell(1).value === ctx.a1.lrn);
  assert.deepEqual([a1.getCell(3).value, a1.getCell(4).value, a1.getCell(5).value, a1.getCell(6).value], [85, 'Finalized', 90, 'Submitted']);
});

// --- Admin monitoring (Analytics → Monitoring) -----------------------------------

const monitoringUrl = (period) => `/api/analytics/monitoring?gradingPeriodId=${period.id}`;

test('monitoring: enrollment per section, and grade status per class counted over the enrolled learners', async () => {
  const res = await api.get(monitoringUrl(ctx.t2), { token: ctx.admin.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const sec = (s) => res.body.sections.find((r) => r.sectionId === s.id);
  assert.deepEqual([sec(ctx.sectionA).learners, sec(ctx.sectionA).classes, sec(ctx.sectionA).enrollments], [2, 2, 4]);
  assert.deepEqual([sec(ctx.sectionB).learners, sec(ctx.sectionB).classes, sec(ctx.sectionB).enrollments], [1, 1, 1]);

  const cls = (o) => res.body.classes.find((c) => c.offeringId === o.id);
  // Term 2: X has a1 submitted (a2 missing); Y has a2 verified (a1 missing); Z nobody graded.
  assert.deepEqual(
    [cls(ctx.x).enrolled, cls(ctx.x).submitted, cls(ctx.x).verified, cls(ctx.x).finalized, cls(ctx.x).missing],
    [2, 1, 0, 0, 1]
  );
  assert.deepEqual([cls(ctx.y).verified, cls(ctx.y).missing], [1, 1]);
  assert.deepEqual([cls(ctx.z).enrolled, cls(ctx.z).missing], [1, 1]);

  // Term 1: the Term-2-only class Y is not listed; X is fully finalized.
  const t1 = await api.get(monitoringUrl(ctx.t1), { token: ctx.admin.token });
  assert.ok(!t1.body.classes.some((c) => c.offeringId === ctx.y.id));
  const x1 = t1.body.classes.find((c) => c.offeringId === ctx.x.id);
  assert.deepEqual([x1.finalized, x1.missing], [2, 0]);
});

test('monitoring: at-risk counts match the risk assessments (risk score above 0), per section', async () => {
  const { pool } = require('../../config/db');
  const res = await api.get(monitoringUrl(ctx.t1), { token: ctx.principal.token });
  assert.equal(res.status, 200);
  const expected = (await pool.query(
    `SELECT COUNT(*)::int AS assessed, COUNT(*) FILTER (WHERE risk_score > 0)::int AS at_risk
     FROM risk_assessments WHERE grading_period_id = $1 AND student_id = ANY($2::int[])`,
    [ctx.t1.id, [ctx.a1.id, ctx.a2.id]]
  )).rows[0];
  const a = res.body.sections.find((r) => r.sectionId === ctx.sectionA.id);
  assert.equal(a.assessed, expected.assessed);
  assert.equal(a.atRisk.total, expected.at_risk);
  assert.ok(a.assessed >= 2, 'finalizing T1 recalculated both learners\' risk');
  assert.equal(a.atRisk.total, a.atRisk.high + a.atRisk.medium + a.atRisk.low);
});

test('monitoring: admin and principal only; exports are a PDF and a workbook', async () => {
  for (const who of ['adviserA', 'teacher', 'registrar', 'studentUser']) {
    assert.equal((await api.get(monitoringUrl(ctx.t2), { token: ctx[who].token })).status, 403, who);
  }
  assert.equal((await api.get('/api/analytics/monitoring?gradingPeriodId=abc', { token: ctx.admin.token })).status, 400);
  const pdf = await download(`/api/analytics/monitoring/export/pdf?gradingPeriodId=${ctx.t2.id}`, ctx.principal.token);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  const xlsx = await download(`/api/analytics/monitoring/export/excel?gradingPeriodId=${ctx.t2.id}`, ctx.admin.token);
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Report Info', 'Sections', 'Classes']);
});
