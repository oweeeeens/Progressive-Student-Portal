// The home page's task queue — "what needs you today".
//
// Two things need standing behind them here, and they are different kinds
// of claim.
//
// WHAT THE QUEUE OFFERS is decided by ASSIGNMENT, not by the role column.
// The school staffs its timetable with people who advise one section and
// teach into others, and CLAUDE.md records what happened the last time a
// read path asked `role === 'adviser'` instead: an adviser who also taught
// could submit a student's grade and then get a 404 opening that student's
// record. A queue that asked the role label would quietly hand a teaching
// adviser only half their work, and the half it dropped would be invisible
// — there is no error, just an item that never appears.
//
// WHAT THE QUEUE COUNTS is scoped the same way every other student-derived
// figure is. A dashboard is the easiest place for a scoping bug to hide,
// because a number has no link to follow and nothing on screen says whose
// learners it covers.
//
// Runs against the real Express app and the real database. It borrows
// whichever grading period genuinely covers today (the queue resolves "now"
// from the wall clock and cannot be handed a fixed date) and creates its
// own sections, offerings, students and users inside that year.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers/testServer');
const { createClient } = require('./helpers/client');
const fixtures = require('./helpers/fixtures');

let server;
let api;
let ctx;

// The queue only asks about today's register on a weekday — there is no
// holiday calendar in this schema, so a weekend is the one absence it can
// honestly detect (see dashboardQueueModel.isSchoolDay). Tests run on
// whatever day they run, so the expectation has to know which day it is.
const isWeekday = ![0, 6].includes(new Date().getDay());

async function queueFor(token) {
  const res = await api.get('/api/dashboard/queue', { token });
  assert.equal(res.status, 200);
  return {
    keys: res.body.tasks.map((task) => task.key).sort(),
    byKey: Object.fromEntries(res.body.tasks.map((task) => [task.key, task.count])),
    tasks: res.body.tasks,
  };
}

before(async () => {
  server = await startTestServer();
  api = createClient(server.baseUrl);

  const period = await fixtures.resolveOrCreateCurrentPeriod();
  const schoolYearId = period.school_year_id;

  // Role labels are chosen to CONTRADICT the assignments on purpose. If any
  // of these tests passes because of the label rather than the assignment,
  // it passes for the wrong reason and the next refactor breaks it.
  const [teacherWhoAdvises, adviserWhoOnlyTeaches, otherAdviser, principal, registrar, ict, student] =
    await Promise.all([
      fixtures.createStaffUser('subject_teacher', 'queue-advises'),
      fixtures.createStaffUser('adviser', 'queue-teaches'),
      fixtures.createStaffUser('adviser', 'queue-other-adviser'),
      fixtures.createStaffUser('principal', 'queue-principal'),
      fixtures.createStaffUser('registrar', 'queue-registrar'),
      fixtures.createStaffUser('ict_faculty', 'queue-ict'),
      fixtures.createStaffUser('student', 'queue-student'),
    ]);

  // One section advised by the `subject_teacher`-labelled user, one advised
  // by somebody else but taught into by the `adviser`-labelled user.
  const advisedSection = await fixtures.createTestSection({
    schoolYearId,
    adviserId: teacherWhoAdvises.id,
    label: 'queue-advised',
  });
  const otherSection = await fixtures.createTestSection({
    schoolYearId,
    adviserId: otherAdviser.id,
    label: 'queue-other',
  });

  const subject = await fixtures.createTestSubject('queue-subject');
  // Taught by the adviser-labelled user, into a section they do not advise.
  const taughtOffering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: otherSection.id,
    teacherId: adviserWhoOnlyTeaches.id,
    schoolYearId,
  });
  // And one in the advised section, so there are grades to verify and
  // finalize there.
  const advisedOffering = await fixtures.createTestOffering({
    subjectId: subject.id,
    sectionId: advisedSection.id,
    teacherId: adviserWhoOnlyTeaches.id,
    schoolYearId,
  });

  const [learnerA, learnerB] = await Promise.all([
    fixtures.createTestStudent({ sectionId: advisedSection.id, label: 'queue-learner-a' }),
    fixtures.createTestStudent({ sectionId: advisedSection.id, label: 'queue-learner-b' }),
  ]);

  ctx = {
    schoolYearId,
    ownSchoolYear: period.ownSchoolYear,
    periodId: period.id,
    teacherWhoAdvises,
    adviserWhoOnlyTeaches,
    otherAdviser,
    principal,
    registrar,
    ict,
    student,
    advisedSection,
    otherSection,
    subjectId: subject.id,
    taughtOffering,
    advisedOffering,
    learnerA,
    learnerB,
  };
});

after(async () => {
  await server.close();
  await fixtures.teardown({
    // NOT ours to delete unless resolveOrCreateCurrentPeriod had to invent
    // one — the real seeded school year has to survive this suite.
    schoolYearId: ctx.schoolYearId,
    ownSchoolYear: ctx.ownSchoolYear,
    studentIds: [ctx.learnerA.id, ctx.learnerB.id],
    offeringIds: [ctx.taughtOffering.id, ctx.advisedOffering.id],
    sectionIds: [ctx.advisedSection.id, ctx.otherSection.id],
    subjectIds: [ctx.subjectId],
    userIds: [
      ctx.teacherWhoAdvises.id,
      ctx.adviserWhoOnlyTeaches.id,
      ctx.otherAdviser.id,
      ctx.principal.id,
      ctx.registrar.id,
      ctx.ict.id,
      ctx.student.id,
    ],
  });
});

test('a user labelled subject_teacher who ADVISES a section gets the adviser queue', async () => {
  // The headline claim. Nothing about this user's role column says adviser.
  const { keys } = await queueFor(ctx.teacherWhoAdvises.token);
  assert.ok(keys.includes('finalize_grades'), `missing finalize_grades (${keys.join(', ')})`);
  assert.ok(keys.includes('flagged_without_support'), `missing flagged_without_support (${keys.join(', ')})`);
  assert.ok(keys.includes('stale_interventions'), `missing stale_interventions (${keys.join(', ')})`);
  assert.equal(
    keys.includes('mark_daily_attendance'),
    isWeekday,
    'today-register item should appear on a weekday and only on a weekday'
  );
  // They teach nothing, so the teaching half must NOT appear.
  assert.ok(!keys.includes('submit_grades'), 'offered grade entry while teaching nothing');
});

test('a user labelled adviser who only TEACHES gets the teaching queue and not the adviser one', async () => {
  const { keys } = await queueFor(ctx.adviserWhoOnlyTeaches.token);
  assert.ok(keys.includes('submit_grades'), `missing submit_grades (${keys.join(', ')})`);
  assert.ok(keys.includes('resubmit_rejected_grades'), `missing resubmit_rejected_grades (${keys.join(', ')})`);
  assert.ok(!keys.includes('finalize_grades'), 'offered finalizing while advising nothing');
  assert.ok(!keys.includes('mark_daily_attendance'), 'offered a register while advising no section');
});

test('the counts are what the linked page will show, and are scoped', async () => {
  // Two grades submitted into the advised section, verified by the
  // principal, and therefore waiting on exactly one person: its adviser.
  const submitted = await api.post('/api/grades', {
    token: ctx.adviserWhoOnlyTeaches.token,
    body: {
      classOfferingId: ctx.advisedOffering.id,
      gradingPeriodId: ctx.periodId,
      entries: [
        { studentId: ctx.learnerA.id, gradeValue: 88 },
        { studentId: ctx.learnerB.id, gradeValue: 71 },
      ],
    },
  });
  assert.equal(submitted.status, 201);
  const gradeIds = submitted.body.grades.map((g) => g.id);

  // The principal's backlog moves with it, in both directions. Asserted as
  // a DELTA rather than an absolute: this suite shares a database with
  // whatever else is seeded in it, and a figure that is only correct on an
  // empty database is not a test of the query.
  const beforeVerify = (await queueFor(ctx.principal.token)).byKey.verify_grades;
  assert.equal(typeof beforeVerify, 'number', 'the principal should always be offered the verification item');

  const verified = await api.post('/api/grades/verify', {
    token: ctx.principal.token,
    body: { gradingPeriodId: ctx.periodId, gradeIds },
  });
  assert.equal(verified.status, 200);

  const afterVerify = (await queueFor(ctx.principal.token)).byKey.verify_grades;
  assert.equal(afterVerify, beforeVerify - 2, 'verifying two grades should empty two from the principal queue');

  // ...and lands on the adviser of that section, whose own count IS
  // absolute: this section and these learners were created by this suite.
  const adviserQueue = await queueFor(ctx.teacherWhoAdvises.token);
  assert.equal(adviserQueue.byKey.finalize_grades, 2);

  // Nobody else's figure moved. `otherAdviser` advises a different section.
  const otherQueue = await queueFor(ctx.otherAdviser.token);
  assert.equal(otherQueue.byKey.finalize_grades, 0, 'a different adviser should see none of these');
});

test('the principal is offered the verification backlog and nothing else', async () => {
  // CLAUDE.md is explicit: they approve grades and read the rollup; the
  // per-learner follow-up belongs to advisers and guidance counselors.
  const { keys } = await queueFor(ctx.principal.token);
  assert.deepEqual(keys, ['verify_grades']);
});

test('a registrar is offered account creation and nothing to do with grades', async () => {
  const { keys } = await queueFor(ctx.registrar.token);
  assert.deepEqual(keys, ['pending_student_accounts']);
});

test('ICT faculty and a student are offered no queue at all', async () => {
  // An EMPTY list, not a list of zeroes. The home page renders nothing for
  // these three rather than telling them they are "all caught up", which
  // would be a claim about work they were never given.
  for (const [label, user] of [
    ['ict_faculty', ctx.ict],
    ['student', ctx.student],
  ]) {
    const { tasks } = await queueFor(user.token);
    assert.deepEqual(tasks, [], `${label} should have no queue`);
  }
});

test('the band rollup is scoped the same way, and is empty for a role with no risk scope', async () => {
  const ictBands = await api.get('/api/dashboard/bands', { token: ctx.ict.token });
  assert.equal(ictBands.status, 200);
  assert.deepEqual(ictBands.body.periods, [], 'ICT faculty must see no band data');

  const studentBands = await api.get('/api/dashboard/bands', { token: ctx.student.token });
  assert.equal(studentBands.status, 200);
  assert.deepEqual(studentBands.body.periods, [], 'a learner must not be shown a school-wide rollup');

  // The principal reads the whole school, so their rollup must be at least
  // as large as any one adviser's — the two are the same query with a
  // different scope clause, and this is what catches the clause being
  // dropped.
  const principalBands = await api.get('/api/dashboard/bands', { token: ctx.principal.token });
  const adviserBands = await api.get('/api/dashboard/bands', { token: ctx.teacherWhoAdvises.token });
  assert.equal(principalBands.status, 200);
  assert.equal(adviserBands.status, 200);
  const totalOf = (body) => body.periods.reduce((sum, p) => sum + p.total, 0);
  assert.ok(
    totalOf(principalBands.body) >= totalOf(adviserBands.body),
    'an adviser cannot be shown more learners than the principal'
  );
});

test('every task carries the sentence, the unit and the link the page needs', async () => {
  // The dashboard renders these verbatim. A task with no href is a dead
  // end, and a count with no unit is the "2 items" problem config/
  // dashboardQueue.js exists to prevent.
  const { tasks } = await queueFor(ctx.teacherWhoAdvises.token);
  assert.ok(tasks.length > 0);
  for (const task of tasks) {
    assert.ok(task.title && task.title.length > 3, `${task.key} has no title`);
    assert.ok(task.detail && task.detail.length > 20, `${task.key} has no detail sentence`);
    assert.ok(task.unit, `${task.key} has no unit`);
    assert.ok(task.href && task.href.startsWith('/'), `${task.key} has no destination`);
    assert.ok(['now', 'routine'].includes(task.urgency), `${task.key} has an unknown urgency`);
    assert.equal(typeof task.count, 'number', `${task.key} has a non-numeric count`);
  }
});

test('outstanding work sorts above work that is merely due', async () => {
  const { tasks } = await queueFor(ctx.teacherWhoAdvises.token);
  const firstCleared = tasks.findIndex((task) => task.count === 0);
  const lastOutstanding = tasks.map((task) => task.count > 0).lastIndexOf(true);
  if (firstCleared !== -1 && lastOutstanding !== -1) {
    assert.ok(lastOutstanding < firstCleared, 'a cleared item sorted above an outstanding one');
  }
});
