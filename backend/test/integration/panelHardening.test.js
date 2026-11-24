// Panel compliance re-check (2026-11-24): the defects found by the review of
// the panel's features, each pinned by a test so it cannot come back.
//
//   1. Re-submitting a class record must not undo the principal's
//      verification of grades that did not change.
//   2. A learner marked dropped (or transferred, graduated) is not on any
//      class roster: not on the Class Record, cannot be scored, not in the
//      class grade report, not counted by Monitoring.
//   3. The adviser gradesheet keeps a learner who moved to another section
//      (their finalized grades here are official), labels them, and marks a
//      class they were never in as "not enrolled" instead of "not finalized".
//
// Each group of tests has its own section, so none can disturb another.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const { submitGrades } = require('./helpers/classRecord');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');

let server;
let api;
const ctx = { offeringIds: [], subjectIds: [], studentIds: [], sectionIds: [] };

async function grade(offering, period, entries) {
  const res = await submitGrades(api, { token: ctx.teacher.token, body: { classOfferingId: offering.id, gradingPeriodId: period.id, entries } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.grades.map((g) => g.id);
}
async function verify(gradeIds, period) {
  const res = await api.post('/api/grades/verify', { token: ctx.principal.token, body: { gradeIds, gradingPeriodId: period.id } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}
async function finalize(section, period) {
  const res = await api.post('/api/grades/finalize', { token: ctx.adviser.token, body: { sectionId: section.id, gradingPeriodId: period.id } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}
async function gradeRow(studentId, offeringId, periodId) {
  const r = await pool.query(
    'SELECT grade_value, status, verified_by FROM grades WHERE student_id = $1 AND class_offering_id = $2 AND grading_period_id = $3',
    [studentId, offeringId, periodId]
  );
  return r.rows[0];
}
async function section(label) {
  const s = await fixtures.createTestSection({ schoolYearId: ctx.schoolYearId, adviserId: ctx.adviser.id, label });
  ctx.sectionIds.push(s.id);
  return s;
}
async function offering(sectionRow, label) {
  const subj = await fixtures.createTestSubject(label);
  ctx.subjectIds.push(subj.id);
  const o = await fixtures.createTestOffering({ subjectId: subj.id, sectionId: sectionRow.id, teacherId: ctx.teacher.id, schoolYearId: ctx.schoolYearId });
  ctx.offeringIds.push(o.id);
  return o;
}
async function student(sectionRow, label) {
  const s = await fixtures.createTestStudent({ sectionId: sectionRow.id, label });
  ctx.studentIds.push(s.id);
  return s;
}

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('PHD', [
    // T1 and T2 in the past (started); T3 far in the future (not started).
    { name: 'T1', sequenceNumber: 1, startDate: '2022-06-01', endDate: '2022-08-31' },
    { name: 'T2', sequenceNumber: 2, startDate: '2022-09-01', endDate: '2022-11-30' },
    { name: 'T3', sequenceNumber: 3, startDate: '2099-01-04', endDate: '2099-03-31' },
  ]);
  ctx.schoolYearId = schoolYearId;
  [ctx.t1, ctx.t2, ctx.t3] = periods;
  const users = await Promise.all([
    fixtures.createStaffUser('admin', 'phd-admin'),
    fixtures.createStaffUser('principal', 'phd-principal'),
    fixtures.createStaffUser('adviser', 'phd-adviser'),
    fixtures.createStaffUser('subject_teacher', 'phd-teacher'),
  ]);
  [ctx.admin, ctx.principal, ctx.adviser, ctx.teacher] = users;
  ctx.userIds = users.map((u) => u.id);
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: ctx.userIds,
    studentIds: ctx.studentIds,
    offeringIds: ctx.offeringIds,
    subjectIds: ctx.subjectIds,
    sectionIds: ctx.sectionIds,
  });
});

// --- 1. Re-submitting keeps unchanged verified grades verified ------------------

test('re-submitting a class record leaves unchanged verified grades verified, and resubmits only what changed', async () => {
  const sec = await section('phd-resubmit');
  const cls = await offering(sec, 'phd-resubmit-x');
  const a1 = await student(sec, 'phd-r1');
  const a2 = await student(sec, 'phd-r2');

  await verify(await grade(cls, ctx.t1, [{ studentId: a1.id, gradeValue: 80 }, { studentId: a2.id, gradeValue: 80 }]), ctx.t1);
  assert.equal((await gradeRow(a1.id, cls.id, ctx.t1.id)).status, 'principal_verified');

  // a1 unchanged, a2's scores raised so the grade changes.
  const resubmitted = await grade(cls, ctx.t1, [{ studentId: a1.id, gradeValue: 80 }, { studentId: a2.id, gradeValue: 85 }]);
  assert.equal(resubmitted.length, 1, 'only the changed grade is resubmitted');

  const r1 = await gradeRow(a1.id, cls.id, ctx.t1.id);
  assert.equal(r1.status, 'principal_verified', 'the unchanged grade keeps its verification');
  assert.equal(r1.verified_by, ctx.principal.id, 'and who verified it');
  const r2 = await gradeRow(a2.id, cls.id, ctx.t1.id);
  assert.equal(r2.status, 'submitted', 'the changed grade goes back to the principal');
  assert.equal(Number(r2.grade_value), 85);

  // Submitting again with nothing changed is not an error, and changes nothing.
  const again = await api.post('/api/class-record/submit', { token: ctx.teacher.token, body: { classOfferingId: cls.id, gradingPeriodId: ctx.t1.id } });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.submitted, 0);
  assert.equal(again.body.unchanged, 2);
  assert.equal((await gradeRow(a1.id, cls.id, ctx.t1.id)).status, 'principal_verified');
});

test('a rejected grade is always resubmitted, even with the same value', async () => {
  const sec = await section('phd-reject');
  const cls = await offering(sec, 'phd-reject-x');
  const a1 = await student(sec, 'phd-j1');
  const [id] = await grade(cls, ctx.t1, [{ studentId: a1.id, gradeValue: 82 }]);
  const rej = await api.post('/api/grades/reject', { token: ctx.principal.token, body: { gradeIds: [id], gradingPeriodId: ctx.t1.id, note: 'Please re-check the scores.' } });
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal((await gradeRow(a1.id, cls.id, ctx.t1.id)).status, 'rejected');
  await grade(cls, ctx.t1, [{ studentId: a1.id, gradeValue: 82 }]);
  assert.equal((await gradeRow(a1.id, cls.id, ctx.t1.id)).status, 'submitted');
});

// --- 2. A dropped learner is off every roster -----------------------------------

test('a dropped learner is off the class roster: not on the Class Record, cannot be scored, not reported, not counted', async () => {
  const sec = await section('phd-drop');
  const cls = await offering(sec, 'phd-drop-x');
  const stay = await student(sec, 'phd-d1');
  const dropped = await student(sec, 'phd-d2');
  await pool.query("UPDATE students SET enrollment_status = 'dropped' WHERE id = $1", [dropped.id]);

  // Class Record.
  const record = await api.get(`/api/class-record?classOfferingId=${cls.id}&gradingPeriodId=${ctx.t1.id}`, { token: ctx.teacher.token });
  assert.equal(record.status, 200, JSON.stringify(record.body));
  const ids = record.body.learners.map((l) => l.studentId);
  assert.ok(ids.includes(stay.id));
  assert.ok(!ids.includes(dropped.id), 'not on the Class Record');

  // Scoring them is refused.
  const item = await api.post('/api/class-record/items', {
    token: ctx.teacher.token,
    body: { classOfferingId: cls.id, gradingPeriodId: ctx.t1.id, component: 'ww', title: 'Quiz', highestPossibleScore: 10 },
  });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  const score = await api.put('/api/class-record/scores', {
    token: ctx.teacher.token,
    body: { classOfferingId: cls.id, gradingPeriodId: ctx.t1.id, scores: [{ itemId: item.body.item.id, studentId: dropped.id, rawScore: 8 }] },
  });
  assert.equal(score.status, 400, 'a dropped learner cannot be scored');

  // The teacher's class grade report.
  const report = await api.get(`/api/reports/class-grades?classOfferingId=${cls.id}`, { token: ctx.teacher.token });
  assert.deepEqual(report.body.rows.map((r) => r.studentId), [stay.id]);

  // Monitoring counts only the enrolled learner.
  const mon = await api.get(`/api/analytics/monitoring?gradingPeriodId=${ctx.t1.id}`, { token: ctx.admin.token });
  assert.equal(mon.status, 200, JSON.stringify(mon.body));
  const secRow = mon.body.sections.find((s) => s.sectionId === sec.id);
  assert.equal(secRow.learners, 1);
  assert.equal(secRow.enrollments, 1);
  const clsRow = mon.body.classes.find((c) => c.offeringId === cls.id);
  assert.equal(clsRow.enrolled, 1);
  assert.equal(clsRow.missing, 1, 'only the enrolled learner is missing a grade');

  // On the gradesheet they stay (labelled), and their missing grades are not
  // counted against the section: they will never come.
  const gs = await api.get(`/api/reports/gradesheet?sectionId=${sec.id}`, { token: ctx.adviser.token });
  const droppedRow = gs.body.periods[0].rows.find((r) => r.studentId === dropped.id);
  assert.equal(droppedRow.note, 'Dropped');
  assert.equal(droppedRow.expectedCount, 0);
  assert.equal(gs.body.periods[0].cellCount, 1, "only the enrolled learner's grade is expected");

  // Set back to enrolled, they are on the roster again.
  await pool.query("UPDATE students SET enrollment_status = 'enrolled' WHERE id = $1", [dropped.id]);
  const back = await api.get(`/api/class-record?classOfferingId=${cls.id}&gradingPeriodId=${ctx.t1.id}`, { token: ctx.teacher.token });
  assert.ok(back.body.learners.some((l) => l.studentId === dropped.id));
});

// --- 3. The gradesheet keeps movers, labelled ------------------------------------

test('gradesheet: a learner who moved keeps their finalized grades on the old section, labelled; a class they were never in is n/e', async () => {
  const from = await section('phd-from');
  const to = await section('phd-to');
  const p = await offering(from, 'phd-p');
  const q = await offering(to, 'phd-q');
  const mover = await student(from, 'phd-m1');
  const stays = await student(from, 'phd-m2');

  // Term 1 in the old section, through the whole chain.
  await verify(await grade(p, ctx.t1, [{ studentId: mover.id, gradeValue: 88 }, { studentId: stays.id, gradeValue: 79 }]), ctx.t1);
  await finalize(from, ctx.t1);

  // The learner moves; then a new class is added to the old section.
  await pool.query('UPDATE students SET current_section_id = $1 WHERE id = $2', [to.id, mover.id]);
  const w = await offering(from, 'phd-w');

  const old = await api.get(`/api/reports/gradesheet?sectionId=${from.id}`, { token: ctx.adviser.token });
  assert.equal(old.status, 200, JSON.stringify(old.body));
  const t1 = old.body.periods[0];
  const pIndex = t1.subjects.findIndex((s) => s.offeringId === p.id);
  const wIndex = t1.subjects.findIndex((s) => s.offeringId === w.id);
  const moverRow = t1.rows.find((r) => r.studentId === mover.id);
  assert.ok(moverRow, 'the learner who moved stays on the old section\'s gradesheet');
  assert.equal(moverRow.grades[pIndex], 88, 'with their finalized grade');
  assert.equal(moverRow.note, `Moved to ${to.name}`);
  assert.equal(moverRow.notEnrolled[wIndex], true, 'a class added after they left is not enrolled');
  assert.equal(moverRow.expectedCount, 1, 'and is not counted against them');
  assert.equal(moverRow.complete, true);
  const staysRow = t1.rows.find((r) => r.studentId === stays.id);
  assert.equal(staysRow.note, null);
  assert.equal(staysRow.notEnrolled[wIndex], false, 'a learner still in the section is enrolled in the new class');

  const now = await api.get(`/api/reports/gradesheet?sectionId=${to.id}`, { token: ctx.adviser.token });
  const nowRow = now.body.periods[0].rows.find((r) => r.studentId === mover.id);
  assert.equal(nowRow.note, `Moved here from ${from.name}`);
  const qIndex = now.body.periods[0].subjects.findIndex((s) => s.offeringId === q.id);
  assert.equal(nowRow.notEnrolled[qIndex], false, 'enrolled in the new section\'s class');

  // The exports carry the same: the workbook has the note and the n/e cell.
  const res = await fetch(`${server.baseUrl}/api/reports/gradesheet/export/excel?sectionId=${from.id}`, { headers: { Authorization: `Bearer ${ctx.adviser.token}` } });
  assert.equal(res.status, 200);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const sheet = wb.getWorksheet('T1');
  const header = sheet.getRow(1).values.slice(1);
  const rowOf = [2, 3].map((r) => sheet.getRow(r)).find((r) => r.getCell(header.indexOf('LRN') + 1).value === mover.lrn);
  assert.equal(rowOf.getCell(header.indexOf('Note') + 1).value, `Moved to ${to.name}`);
  assert.equal(rowOf.getCell(header.findIndex((h) => String(h).includes('phd-w')) + 1).value, 'n/e');
  const pdf = await fetch(`${server.baseUrl}/api/reports/gradesheet/export/pdf?sectionId=${from.id}`, { headers: { Authorization: `Bearer ${ctx.adviser.token}` } });
  assert.equal(pdf.status, 200);
});

// --- 4. A term that has not started is not a backlog ---------------------------

test('a term that has not started yet: its empty cells are "not started", not "not submitted" or "not finalized"', async () => {
  const sec = await section('phd-future');
  const cls = await offering(sec, 'phd-future-x');
  const a1 = await student(sec, 'phd-f1');
  await verify(await grade(cls, ctx.t1, [{ studentId: a1.id, gradeValue: 84 }]), ctx.t1);
  await finalize(sec, ctx.t1);

  const report = await api.get(`/api/reports/class-grades?classOfferingId=${cls.id}`, { token: ctx.teacher.token });
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.deepEqual(report.body.periods.map((p) => p.started), [true, true, false]);
  // T1 finalized, T2 (started, empty) not submitted, T3 (future) not started.
  assert.equal(report.body.statusCounts.finalized, 1);
  assert.equal(report.body.statusCounts.none, 1);
  assert.equal(report.body.statusCounts.notStarted, 1);

  const gs = await api.get(`/api/reports/gradesheet?sectionId=${sec.id}`, { token: ctx.adviser.token });
  const [p1, p2, p3] = gs.body.periods;
  assert.equal(p1.finalizedCells, 1);
  assert.equal(p1.cellCount, 1);
  assert.equal(p2.cellCount, 1, 'a started term expects its grade');
  assert.equal(p3.started, false);
  assert.equal(p3.cellCount, 0, 'a term that has not started expects nothing yet');

  // The workbook says "Not started", the PDF opens.
  const res = await fetch(`${server.baseUrl}/api/reports/class-grades/export/excel?classOfferingId=${cls.id}`, { headers: { Authorization: `Bearer ${ctx.teacher.token}` } });
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const sheet = wb.getWorksheet('Grades');
  const header = sheet.getRow(1).values.slice(1);
  assert.equal(sheet.getRow(2).getCell(header.indexOf('T3 status') + 1).value, 'Not started');
  assert.equal(sheet.getRow(2).getCell(header.indexOf('T2 status') + 1).value, 'Not submitted');
});
