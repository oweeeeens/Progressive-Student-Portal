// Integration coverage for importing a DepEd e-Class Record workbook into the
// Class Record: the layout is read, learners are matched to the section by
// LRN, the System's computed grade is cross-checked against the workbook's
// own, and nothing is written until commit — and only by the class teacher.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');
const { buildEclassWorkbook } = require('../../scripts/lib/eclassWorkbook');

let server;
let api;
let ctx;
let parsed;

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);
  const { schoolYearId, periods } = await fixtures.createSchoolYearWithPeriods('EC', [
    { name: 'Term 1', sequenceNumber: 1, startDate: '2032-06-01', endDate: '2032-09-15' },
    { name: 'Term 2', sequenceNumber: 2, startDate: '2032-09-16', endDate: '2032-12-20' },
  ]);
  const [teacher, otherTeacher, adviser] = await Promise.all([
    fixtures.createStaffUser('subject_teacher', 'ec-teacher'),
    fixtures.createStaffUser('subject_teacher', 'ec-other'),
    fixtures.createStaffUser('adviser', 'ec-adviser'),
  ]);
  const section = await fixtures.createTestSection({ schoolYearId, adviserId: adviser.id, label: 'ec-section' });
  const subject = await fixtures.createTestSubject('ec-subject');
  const offering = await fixtures.createTestOffering({ subjectId: subject.id, sectionId: section.id, teacherId: teacher.id, schoolYearId });
  const [learnerA, learnerB] = await Promise.all([
    fixtures.createTestStudent({ sectionId: section.id, label: 'ec-a' }),
    fixtures.createTestStudent({ sectionId: section.id, label: 'ec-b' }),
  ]);
  ctx = { schoolYearId, periods, teacher, otherTeacher, adviser, section, subject, offering, learnerA, learnerB };
});

after(async () => {
  await fixtures.teardown({
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: true,
    userIds: [ctx.teacher.id, ctx.otherTeacher.id, ctx.adviser.id],
    studentIds: [ctx.learnerA.id, ctx.learnerB.id],
    subjectIds: [ctx.subject.id],
    sectionIds: [ctx.section.id],
    offeringIds: [ctx.offering.id],
  });
  await server.close();
});

// Learner A carries DepEd's own worked example (DO 015 Annex D, Table 5),
// which computes to 88; the workbook says 88 for A. For B it says 90 while
// B's scores compute to something else — the cross-check must flag that.
async function workbook() {
  return buildEclassWorkbook({
    section: 'Test Section',
    subject: 'Test Subject',
    teacher: 'Test Teacher',
    learners: [
      { lrn: ctx.learnerA.lrn, name: `${ctx.learnerA.last_name}, ${ctx.learnerA.first_name} M.`, gender: 'male' },
      { lrn: ctx.learnerB.lrn, name: `${ctx.learnerB.last_name}, ${ctx.learnerB.first_name}`, gender: 'female' },
      { lrn: '999999999999', name: 'Nobody, Unknown', gender: 'female' },
    ],
    terms: [
      {
        sequence: 1,
        hps: { ww1: 20, ww2: 25, ww3: 20, ww4: 20, pt1: 25, pt2: 25, st1: 20, st2: 20, te: 40 },
        scores: {
          [ctx.learnerA.lrn]: { ww1: 17, ww2: 22, ww3: 20, ww4: 15, pt1: 20, pt2: 23, st1: 15, st2: 18, te: 35 },
          [ctx.learnerB.lrn]: { ww1: 10, ww2: 10, ww3: 10, ww4: 10, pt1: 10, pt2: 10, st1: 10, st2: 10, te: 20 },
        },
        termGrades: { [ctx.learnerA.lrn]: 88, [ctx.learnerB.lrn]: 90 },
      },
    ],
  });
}

test('only the teacher of the class can import into it', async () => {
  const res = await api.upload('/api/class-record/import/parse', {
    token: ctx.otherTeacher.token,
    buffer: await workbook(),
    fields: { classOfferingId: ctx.offering.id },
  });
  assert.equal(res.status, 403);
});

test('a file that is not an e-Class Record is refused with a reason', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sheet1').getCell('A1').value = 'hello';
  const res = await api.upload('/api/class-record/import/parse', {
    token: ctx.teacher.token,
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    fields: { classOfferingId: ctx.offering.id },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not a DepEd e-Class Record/);
});

test('parsing reads the layout, matches by LRN, and cross-checks the grades — writing nothing', async () => {
  const res = await api.upload('/api/class-record/import/parse', {
    token: ctx.teacher.token,
    buffer: await workbook(),
    fields: { classOfferingId: ctx.offering.id },
  });
  assert.equal(res.status, 200);
  parsed = res.body;
  const term = parsed.plan.terms[0];
  assert.equal(term.status, 'ready');
  assert.equal(term.itemCount, 9, '4 written works, 2 tasks, ST1, ST2 and the term exam');
  assert.equal(term.learners.length, 2);
  assert.deepEqual(term.unmatched.map((u) => u.name), ['Nobody, Unknown']);

  const a = term.learners.find((l) => l.studentId === ctx.learnerA.id);
  assert.equal(a.matchedBy, 'LRN');
  assert.equal(a.computedTermGrade, 88, "DepEd's worked example computes to 88");
  assert.equal(a.mismatch, false, 'and agrees with the workbook');
  const b = term.learners.find((l) => l.studentId === ctx.learnerB.id);
  assert.equal(b.mismatch, true, "B's workbook grade does not match the scores — flagged");

  const record = await api.get(`/api/class-record?classOfferingId=${ctx.offering.id}&gradingPeriodId=${ctx.periods[0].id}`, { token: ctx.teacher.token });
  assert.equal(record.body.items.length, 0, 'parse wrote nothing');
});

test('committing writes the items and scores, which then compute in the Class Record', async () => {
  const res = await api.post('/api/class-record/import/commit', {
    token: ctx.teacher.token,
    body: { classOfferingId: ctx.offering.id, terms: parsed.terms, decisions: {}, fileName: 'ecr.xlsx' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.itemCount, 9);
  assert.equal(res.body.scoreCount, 18);

  const record = await api.get(`/api/class-record?classOfferingId=${ctx.offering.id}&gradingPeriodId=${ctx.periods[0].id}`, { token: ctx.teacher.token });
  const a = record.body.learners.find((l) => l.studentId === ctx.learnerA.id);
  assert.equal(a.computed.termGrade, 88);
  assert.equal(a.grade, null, 'importing does not submit grades — the teacher still does');
});

test('importing again asks whether to replace the term, and replace works', async () => {
  const again = await api.upload('/api/class-record/import/parse', {
    token: ctx.teacher.token,
    buffer: await workbook(),
    fields: { classOfferingId: ctx.offering.id },
  });
  assert.equal(again.body.plan.terms[0].needsDecision, true);

  const undecided = await api.post('/api/class-record/import/commit', {
    token: ctx.teacher.token,
    body: { classOfferingId: ctx.offering.id, terms: again.body.terms, decisions: {} },
  });
  assert.equal(undecided.status, 409, 'an existing term is never overwritten silently');

  const replaced = await api.post('/api/class-record/import/commit', {
    token: ctx.teacher.token,
    body: { classOfferingId: ctx.offering.id, terms: again.body.terms, decisions: { 1: 'replace' } },
  });
  assert.equal(replaced.status, 201);
  const record = await api.get(`/api/class-record?classOfferingId=${ctx.offering.id}&gradingPeriodId=${ctx.periods[0].id}`, { token: ctx.teacher.token });
  assert.equal(record.body.items.length, 9, 'replaced, not duplicated');
});

test("the learner's own record shows the imported scores", async () => {
  const res = await api.get(`/api/students/${ctx.learnerA.id}/class-record`, { token: ctx.adviser.token });
  assert.equal(res.status, 200);
  const subject = res.body.subjects.find((s) => s.classOfferingId === ctx.offering.id);
  const term = subject.terms[ctx.periods[0].id];
  assert.equal(term.items.length, 9);
  assert.equal(term.computed.termGrade, 88);
  assert.equal(term.provisional, true, 'computed but not yet submitted');
});
