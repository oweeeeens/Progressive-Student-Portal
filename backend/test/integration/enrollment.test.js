// Subject enrollment (class_enrollments, migration 20261118100000000).
//
// The panel's rules, each proved here against the real database and API:
//   - a learner given a section is enrolled in every active class of it;
//   - a class added to a section mid-year enrolls the section's learners;
//   - changing section moves the enrollment, while grades already given
//     stay on the old class and keep showing on the learner's record;
//   - grade entry accepts only enrolled learners — scores, submission, the
//     model beneath them, and the e-Class Record import;
//   - a class that already has recorded work cannot be moved to another
//     section (it would orphan that work).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const { submitGrades } = require('./helpers/classRecord');
const fixtures = require('./helpers/fixtures');
const { pool } = require('../../config/db');
const gradeModel = require('../../models/gradeModel');
const assessmentModel = require('../../models/assessmentModel');
const { buildImportPlan } = require('../../services/eclassRecordImport');

let server;
let api;
const ctx = { studentIds: [], offeringIds: [], subjectIds: [], sectionIds: [], userIds: [] };

// Who is enrolled in a class, straight from the table: { studentId: status }.
async function enrollmentStatuses(offeringId) {
  const rows = (await pool.query('SELECT student_id, status FROM class_enrollments WHERE class_offering_id = $1', [offeringId])).rows;
  return Object.fromEntries(rows.map((r) => [r.student_id, r.status]));
}

async function addOffering(label, sectionId) {
  const subject = await fixtures.createTestSubject(label);
  ctx.subjectIds.push(subject.id);
  const offering = await fixtures.createTestOffering({ subjectId: subject.id, sectionId, teacherId: ctx.teacher.id, schoolYearId: ctx.schoolYearId });
  ctx.offeringIds.push(offering.id);
  return offering;
}

async function addStudent(label, sectionId) {
  const student = await fixtures.createTestStudent({ sectionId, label });
  ctx.studentIds.push(student.id);
  return student;
}

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('ENRL', [
    { name: 'T1', sequenceNumber: 1, startDate: '2041-06-01', endDate: '2041-08-31' },
    { name: 'T2', sequenceNumber: 2, startDate: '2041-09-01', endDate: '2041-11-30' },
  ]);
  ctx.schoolYearId = schoolYearId;
  ctx.period1 = periods[0];

  const [admin, registrar, teacher, adviserA, adviserB] = await Promise.all([
    fixtures.createStaffUser('admin', 'enrl-admin'),
    fixtures.createStaffUser('registrar', 'enrl-registrar'),
    fixtures.createStaffUser('subject_teacher', 'enrl-teacher'),
    fixtures.createStaffUser('adviser', 'enrl-adviser-a'),
    fixtures.createStaffUser('adviser', 'enrl-adviser-b'),
  ]);
  Object.assign(ctx, { admin, registrar, teacher, adviserA, adviserB });
  ctx.userIds.push(admin.id, registrar.id, teacher.id, adviserA.id, adviserB.id);

  ctx.sectionA = await fixtures.createTestSection({ schoolYearId, adviserId: adviserA.id, label: 'enrl-a' });
  ctx.sectionB = await fixtures.createTestSection({ schoolYearId, adviserId: adviserB.id, label: 'enrl-b' });
  ctx.sectionIds.push(ctx.sectionA.id, ctx.sectionB.id);

  // Classes first, learners after: the STUDENT trigger enrolls them.
  ctx.a1 = await addOffering('enrl-a1', ctx.sectionA.id);
  ctx.a2 = await addOffering('enrl-a2', ctx.sectionA.id);
  ctx.b1 = await addOffering('enrl-b1', ctx.sectionB.id);
  ctx.s1 = await addStudent('enrl-s1', ctx.sectionA.id);
  ctx.s2 = await addStudent('enrl-s2', ctx.sectionA.id);
  ctx.s3 = await addStudent('enrl-s3', ctx.sectionB.id);
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

test('a learner given a section is enrolled in every active class of that section, and no other', async () => {
  assert.deepEqual(await enrollmentStatuses(ctx.a1.id), { [ctx.s1.id]: 'enrolled', [ctx.s2.id]: 'enrolled' });
  assert.deepEqual(await enrollmentStatuses(ctx.a2.id), { [ctx.s1.id]: 'enrolled', [ctx.s2.id]: 'enrolled' });
  assert.deepEqual(await enrollmentStatuses(ctx.b1.id), { [ctx.s3.id]: 'enrolled' });

  // The Class Record's roster is exactly the enrolled learners.
  const record = await api.get(`/api/class-record?classOfferingId=${ctx.a1.id}&gradingPeriodId=${ctx.period1.id}`, { token: ctx.teacher.token });
  assert.equal(record.status, 200);
  assert.deepEqual(record.body.learners.map((l) => l.studentId).sort(), [ctx.s1.id, ctx.s2.id].sort());
});

test('a class added to a section mid-year enrolls the learners already in it', async () => {
  ctx.a3 = await addOffering('enrl-a3', ctx.sectionA.id);
  assert.deepEqual(await enrollmentStatuses(ctx.a3.id), { [ctx.s1.id]: 'enrolled', [ctx.s2.id]: 'enrolled' });
});

test('a learner added through bulk import is enrolled too (the rule lives in the database)', async () => {
  const bulkImportModel = require('../../models/bulkImportModel');
  const result = await bulkImportModel.insertStudentsBatch([
    { rowNumber: 2, data: { lrn: `8${Date.now().toString().slice(-11)}`, firstName: 'Bulk', lastName: 'Imported', dateOfBirth: '2009-01-01', currentSectionId: ctx.sectionB.id } },
  ]);
  assert.equal(result.insertedCount, 1, JSON.stringify(result));
  const row = (await pool.query("SELECT id FROM students WHERE first_name = 'Bulk' AND last_name = 'Imported' AND current_section_id = $1", [ctx.sectionB.id])).rows[0];
  ctx.studentIds.push(row.id);
  assert.equal((await enrollmentStatuses(ctx.b1.id))[row.id], 'enrolled');
});

test('changing section moves the enrollment; the old grade stays on the old class and on the learner record', async () => {
  // s2 gets a grade in A1 first.
  const graded = await submitGrades(api, {
    token: ctx.teacher.token,
    body: { classOfferingId: ctx.a1.id, gradingPeriodId: ctx.period1.id, entries: [{ studentId: ctx.s2.id, gradeValue: 84 }] },
  });
  assert.equal(graded.status, 201, JSON.stringify(graded.body));

  // The registrar moves s2 to section B through the normal student form.
  const moved = await api.patch(`/api/students/${ctx.s2.id}`, { token: ctx.registrar.token, body: { currentSectionId: ctx.sectionB.id } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));

  assert.equal((await enrollmentStatuses(ctx.a1.id))[ctx.s2.id], 'moved');
  assert.equal((await enrollmentStatuses(ctx.a2.id))[ctx.s2.id], 'moved');
  assert.equal((await enrollmentStatuses(ctx.b1.id))[ctx.s2.id], 'enrolled');

  // The grade is untouched and still on A1.
  const grade = (await pool.query('SELECT class_offering_id, grade_value FROM grades WHERE student_id = $1', [ctx.s2.id])).rows;
  assert.deepEqual(grade.map((g) => [g.class_offering_id, Number(g.grade_value)]), [[ctx.a1.id, 84]]);

  // A1's roster no longer lists s2…
  const record = await api.get(`/api/class-record?classOfferingId=${ctx.a1.id}&gradingPeriodId=${ctx.period1.id}`, { token: ctx.teacher.token });
  assert.ok(!record.body.learners.some((l) => l.studentId === ctx.s2.id));

  // …but s2's own class record still shows A1 with that grade, marked as a
  // class from a section they have left.
  const own = await api.get(`/api/students/${ctx.s2.id}/class-record`, { token: ctx.admin.token });
  assert.equal(own.status, 200);
  const a1 = own.body.subjects.find((s) => s.classOfferingId === ctx.a1.id);
  assert.ok(a1, 'the class the learner left is still on their record');
  assert.equal(a1.enrollmentStatus, 'moved');
  assert.equal(a1.terms[ctx.period1.id].grade.value, 84);
  assert.ok(own.body.subjects.some((s) => s.classOfferingId === ctx.b1.id && s.enrollmentStatus === 'enrolled'));

  // Moving back re-enrolls the same rows rather than adding new ones.
  await api.patch(`/api/students/${ctx.s2.id}`, { token: ctx.registrar.token, body: { currentSectionId: ctx.sectionA.id } });
  assert.equal((await enrollmentStatuses(ctx.a1.id))[ctx.s2.id], 'enrolled');
  assert.equal((await enrollmentStatuses(ctx.b1.id))[ctx.s2.id], 'moved');
  const rows = await pool.query('SELECT COUNT(*)::int n FROM class_enrollments WHERE student_id = $1 AND class_offering_id = $2', [ctx.s2.id, ctx.a1.id]);
  assert.equal(rows.rows[0].n, 1);
});

test('grade entry refuses a learner who is not enrolled in the class', async () => {
  // Scores: s3 is in section B, not enrolled in A1.
  const opened = await api.get(`/api/class-record?classOfferingId=${ctx.a1.id}&gradingPeriodId=${ctx.period1.id}`, { token: ctx.teacher.token });
  const itemId = opened.body.items[0].id;
  const score = await api.put('/api/class-record/scores', {
    token: ctx.teacher.token,
    body: { classOfferingId: ctx.a1.id, gradingPeriodId: ctx.period1.id, scores: [{ itemId, studentId: ctx.s3.id, rawScore: 50 }] },
  });
  assert.equal(score.status, 400);
  assert.match(score.body.error, /not enrolled/);

  // Submitting: asking for s3 submits nobody.
  const submit = await api.post('/api/class-record/submit', {
    token: ctx.teacher.token,
    body: { classOfferingId: ctx.a1.id, gradingPeriodId: ctx.period1.id, studentIds: [ctx.s3.id] },
  });
  assert.equal(submit.status, 400);
  assert.equal((await pool.query('SELECT 1 FROM grades WHERE student_id = $1 AND class_offering_id = $2', [ctx.s3.id, ctx.a1.id])).rowCount, 0);

  // The model beneath every caller refuses too, with a 400 the API passes on.
  await assert.rejects(
    gradeModel.upsertSubmittedGrades({ classOfferingId: ctx.a1.id, gradingPeriodId: ctx.period1.id, recordedBy: ctx.teacher.id, entries: [{ studentId: ctx.s3.id, gradeValue: 80 }] }),
    (err) => err.statusCode === 400 && /not enrolled/.test(err.message)
  );

  // The e-Class Record import: s3's row is reported, never matched.
  const offering = await assessmentModel.getOfferingContext(ctx.a1.id);
  const plan = await buildImportPlan(offering, [{
    sequence: 1,
    items: [{ key: 'ww1', component: 'ww', title: 'Quiz', highestPossibleScore: 10 }],
    learners: [
      { row: 17, name: `${ctx.s1.last_name}, ${ctx.s1.first_name}`, lrn: ctx.s1.lrn, scores: { ww1: 9 } },
      // s3's LRN. (Fixture names differ only in digits, which the name
      // fallback ignores, so the row uses a name nobody in the class has —
      // otherwise it would name-match a classmate, a fixture artifact.)
      { row: 18, name: 'Outsider, From Section B', lrn: ctx.s3.lrn, scores: { ww1: 7 } },
    ],
  }]);
  const term = plan.terms[0];
  assert.ok(term.learners.some((l) => l.studentId === ctx.s1.id), 'the enrolled learner is matched');
  assert.ok(!term.learners.some((l) => l.studentId === ctx.s3.id), 'the learner from another section is not');
  assert.equal(term.learners.length, 1, 'only the enrolled learner is matched');
  assert.ok(term.unmatched.some((u) => u.lrn === ctx.s3.lrn));
});

test('an inactive learner is not on the roster; reactivating puts them back', async () => {
  const off = await api.delete(`/api/students/${ctx.s1.id}`, { token: ctx.registrar.token });
  assert.ok([200, 204].includes(off.status), JSON.stringify(off.body));
  let record = await api.get(`/api/class-record?classOfferingId=${ctx.a2.id}&gradingPeriodId=${ctx.period1.id}`, { token: ctx.teacher.token });
  assert.ok(!record.body.learners.some((l) => l.studentId === ctx.s1.id));

  const on = await api.post(`/api/students/${ctx.s1.id}/reactivate`, { token: ctx.registrar.token });
  assert.ok([200, 204].includes(on.status), JSON.stringify(on.body));
  record = await api.get(`/api/class-record?classOfferingId=${ctx.a2.id}&gradingPeriodId=${ctx.period1.id}`, { token: ctx.teacher.token });
  assert.ok(record.body.learners.some((l) => l.studentId === ctx.s1.id));
});

test('a reactivated class enrolls learners who joined the section while it was inactive', async () => {
  const off = await api.post(`/api/class-offerings/${ctx.a3.id}/deactivate`, { token: ctx.admin.token });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const s4 = await addStudent('enrl-s4', ctx.sectionA.id);
  assert.equal((await enrollmentStatuses(ctx.a3.id))[s4.id], undefined, 'not enrolled in an inactive class');

  const on = await api.post(`/api/class-offerings/${ctx.a3.id}/reactivate`, { token: ctx.admin.token });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal((await enrollmentStatuses(ctx.a3.id))[s4.id], 'enrolled');
});

test('a class with recorded work cannot be moved to another section; one without can, and its roster follows', async () => {
  const body = (o, sectionId) => ({ subjectId: o.subject_id, sectionId, teacherId: ctx.teacher.id, schoolYearId: ctx.schoolYearId, term: 'full_year' });

  const refused = await api.put(`/api/class-offerings/${ctx.a1.id}`, { token: ctx.admin.token, body: body(ctx.a1, ctx.sectionB.id) });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /cannot be moved/);

  const movedClass = await api.put(`/api/class-offerings/${ctx.a3.id}`, { token: ctx.admin.token, body: body(ctx.a3, ctx.sectionB.id) });
  assert.equal(movedClass.status, 200, JSON.stringify(movedClass.body));
  const statuses = await enrollmentStatuses(ctx.a3.id);
  assert.equal(statuses[ctx.s1.id], 'moved', "section A's learners leave it");
  assert.equal(statuses[ctx.s3.id], 'enrolled', "section B's learners join it");
});

test("a learner's subject list is their enrollments, each with its teacher", async () => {
  const enrollmentModel = require('../../models/enrollmentModel');
  const subjects = await enrollmentModel.listOfferingsForStudent(ctx.s3.id, { schoolYearId: ctx.schoolYearId });
  const ids = subjects.map((s) => s.id).sort();
  assert.deepEqual(ids, [ctx.b1.id, ctx.a3.id].sort());
  assert.ok(subjects.every((s) => s.teacher_name && s.subject_name));
});

test("the student record's subject list (GET /students/:id/subjects) is the learner's enrollments, never another section's classes", async () => {
  const res = await api.get(`/api/students/${ctx.s3.id}/subjects`, { token: ctx.adviserB.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const enrolled = (await pool.query(
    `SELECT class_offering_id FROM class_enrollments WHERE student_id = $1 AND status = 'enrolled'`, [ctx.s3.id])).rows.map((r) => r.class_offering_id);
  assert.deepEqual(res.body.subjects.map((s) => s.id).sort(), enrolled.sort());
  // None of section A's current classes appear for a learner of section B.
  for (const aClass of [ctx.a1.id, ctx.a2.id]) assert.ok(!res.body.subjects.some((s) => s.id === aClass));
  assert.ok(res.body.subjects.every((s) => s.enrollment_status === 'enrolled' && s.teacher_name && s.term));
});
