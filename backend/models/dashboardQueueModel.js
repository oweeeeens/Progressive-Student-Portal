// "What needs you today" — the home page's lead content.
//
// WHY THIS IS A SEPARATE MODULE FROM dashboardModel.js
//
// dashboardModel answers "how big is my world" (how many students, how many
// flagged, how many open cases). Those are figures to read. This module
// answers a different question: "what is waiting on ME, right now". Those
// are things to DO, each one a count plus the page that clears it. The two
// are counted from different tables with different scoping rules, and
// keeping them apart is what lets either change without disturbing the
// other.
//
// THREE RULES THAT MADE THIS CORRECT RATHER THAN MERELY WORKING
//
// 1. Every item is earned by ASSIGNMENT, never by a role label, wherever
//    the work itself is assignment-based. An adviser's register and a
//    teacher's classes come from sections.adviser_id and
//    class_offerings.teacher_id, so a teacher who advises one section and
//    teaches into two others gets BOTH halves of the queue. This is the
//    same rule CLAUDE.md states for every permission decision, and the
//    same reason studentModel.appendScopeClause ORs its predicates instead
//    of switching on a role.
//
// 2. A count must be the number the linked page will show. Where a figure
//    already exists elsewhere it is reused, not re-queried: the principal's
//    verification backlog comes from dashboardModel's own
//    countSubmittedGrades, and the temporary-password figure from
//    userModel.countAccounts, which is exactly what User Management's own
//    stat card counts. A dashboard that says 3 and a page that shows 2 is
//    worse than no dashboard.
//
// 3. Nothing here invents a deadline the school does not have. There is no
//    holiday calendar in this schema, so "today's register is not marked"
//    is only asked on a weekday that falls inside a grading period - see
//    isSchoolDay below.
const { pool } = require('../config/db');
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const { appendInterventionScopeClause, BASE_FROM } = require('./studentModel');
const gradingPeriodModel = require('./gradingPeriodModel');
const sectionModel = require('./sectionModel');
const classOfferingModel = require('./classOfferingModel');
const userModel = require('./userModel');
const dashboardModel = require('./dashboardModel');
const { offeringCoversPeriod } = require('../config/academicTerms');
const {
  STALE_INTERVENTION_DAYS,
  QUEUE_ITEMS,
  ROLE_ITEMS,
  ADVISER_ITEMS,
  TEACHER_ITEMS,
  URGENCY_ORDER,
} = require('../config/dashboardQueue');

// Grades this adviser's sections have had verified by the principal and
// that nobody has put into the official record yet - stage three of the
// approval chain. Counted through sections.adviser_id, which is the same
// ownership test GradeFinalizationPage's own list uses.
async function countGradesToFinalize(adviserId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM grades g
       JOIN class_offerings co ON co.id = g.class_offering_id
       JOIN sections sec ON sec.id = co.section_id
      WHERE sec.adviser_id = $1 AND g.grading_period_id = $2 AND g.status = 'principal_verified'`,
    [adviserId, gradingPeriodId]
  );
  return result.rows[0].count;
}

// Sections this person advises with no daily attendance recorded for today.
//
// Counted per SECTION, not per learner: the daily register is the official
// SF2 record and is filed for a whole section at a time, so "2 sections" is
// the number of registers still to open. A section with no active learners
// in it is excluded - there is nothing to mark, and offering it as a task
// would be a chore that can never be completed.
async function countSectionsMissingTodaysRegister(adviserId, today) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM sections sec
       JOIN school_years sy ON sy.id = sec.school_year_id
      WHERE sec.adviser_id = $1
        AND sec.is_active = TRUE
        AND sy.is_current = TRUE
        AND EXISTS (SELECT 1 FROM students s WHERE s.current_section_id = sec.id AND s.is_active = TRUE)
        AND NOT EXISTS (
          SELECT 1
            FROM daily_attendance_records dar
            JOIN students s2 ON s2.id = dar.student_id
           WHERE s2.current_section_id = sec.id AND dar.attendance_date = $2::date
        )`,
    [adviserId, today]
  );
  return result.rows[0].count;
}

// Classes this teacher has not entered any grade for in this period.
//
// The "runs in this term" test is NOT done in SQL. It is
// config/academicTerms.js's offeringCoversPeriod, the same function the
// grade views use, because the policy has two sides (the offering's term
// and the subject's category) and a second copy of it in a WHERE clause is
// a second thing to keep in step. Without it this count would nag a Grade 12
// teacher about a class whose term has already passed.
async function countClassesMissingGrades(teacherId, period) {
  const result = await pool.query(
    `SELECT co.id, co.term, subj.category AS subject_category,
            EXISTS (
              SELECT 1 FROM grades g
               WHERE g.class_offering_id = co.id AND g.grading_period_id = $2
            ) AS has_grades
       FROM class_offerings co
       JOIN subjects subj ON subj.id = co.subject_id
       JOIN school_years sy ON sy.id = co.school_year_id
      WHERE co.teacher_id = $1 AND co.is_active = TRUE AND sy.is_current = TRUE`,
    [teacherId, period.id]
  );

  return result.rows.filter(
    (row) =>
      !row.has_grades &&
      offeringCoversPeriod({
        term: row.term,
        subjectCategory: row.subject_category,
        periodSequenceNumber: period.sequence_number,
      })
  ).length;
}

// Grades the principal sent back to this teacher. These are out of the
// official record entirely until they are resubmitted, which is why they
// sort as work already waiting rather than work merely due.
async function countRejectedGrades(teacherId, gradingPeriodId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM grades g
       JOIN class_offerings co ON co.id = g.class_offering_id
      WHERE co.teacher_id = $1 AND g.grading_period_id = $2 AND g.status = 'rejected'`,
    [teacherId, gradingPeriodId]
  );
  return result.rows[0].count;
}

// Learners flagged this period with no support logged against that
// assessment.
//
// `risk_score > 0` IS the At Risk band - academicProgressCalculator's
// determineBand says so in one line, and asking the stored score directly
// keeps this count from needing the calculator. Note this deliberately
// INCLUDES Low risk, where the at-risk stat card deliberately excludes it:
// the card is "how bad is it", this is "who has nobody looking after them",
// and a Low-risk learner nobody has spoken to is exactly the case the
// closed loop exists to catch. config/dashboardQueue.js's detail text says
// so outright, because the two numbers sitting on the same page would
// otherwise look like one of them is wrong.
//
// interventions.risk_assessment_id ties a logged intervention to the
// assessment that prompted it, so "no support logged" means no intervention
// against THIS period's assessment - last term's closed case does not
// silence this term's flag.
async function countFlaggedWithoutSupport(user, gradingPeriodId) {
  const clauses = ['s.is_active = TRUE', 'ra.grading_period_id = $1', 'ra.risk_score > 0'];
  const params = [gradingPeriodId];
  // Interventions are the learner's adviser's alone, so these two count
  // advisory learners only — never a section the user merely teaches.
  appendInterventionScopeClause(user, clauses, params);

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     ${BASE_FROM}
     JOIN risk_assessments ra ON ra.student_id = s.id
     WHERE ${clauses.join(' AND ')}
       AND NOT EXISTS (SELECT 1 FROM interventions i WHERE i.risk_assessment_id = ra.id)`,
    params
  );
  return result.rows[0].count;
}

// Interventions still Open or Monitoring well past the day they were
// logged. Escalated is excluded for the same reason the open-interventions
// stat card excludes it: it has been handed on, so it is no longer waiting
// on this person.
//
// `date_logged` and not `updated_at`: the question is how long this learner
// has been waiting, not when somebody last touched the row.
async function countStaleInterventions(user, today) {
  const clauses = [
    's.is_active = TRUE',
    "i.status IN ('open', 'monitoring')",
    `i.date_logged < $1::date - $2::int`,
  ];
  const params = [today, STALE_INTERVENTION_DAYS];
  // Interventions are the learner's adviser's alone, so these two count
  // advisory learners only — never a section the user merely teaches.
  appendInterventionScopeClause(user, clauses, params);

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     ${BASE_FROM}
     JOIN interventions i ON i.student_id = s.id
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  return result.rows[0].count;
}

// Active student records with no portal login. The same predicate as
// studentModel's hasAccount=false filter, which is what the Pending Student
// Accounts tab this item links to actually lists.
async function countStudentsWithoutAccounts() {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS count FROM students s WHERE s.is_active = TRUE AND s.user_id IS NULL'
  );
  return result.rows[0].count;
}

// Is today a day the school would expect a register to be filed?
//
// There is no holiday calendar in this schema, so this is the honest limit
// of what can be known: a weekday inside a grading period. Without it the
// dashboard would greet an adviser on Sunday morning with an overdue
// register, which teaches people to ignore the whole list.
//
// `today` is the school's own local date as 'YYYY-MM-DD' (see
// utils/schoolDate.js), and appending T00:00:00 keeps it being read as a
// LOCAL date rather than UTC midnight, which at UTC+8 would name the
// previous day and could report Monday as a Sunday.
function isSchoolDay(today, period) {
  if (!period) return false;
  const weekday = new Date(`${today}T00:00:00`).getDay();
  return weekday !== 0 && weekday !== 6;
}

// Which item keys this person could have, by assignment first and role
// second. Returned as a Set so the counting below can ask "do I need this
// one" without caring how it was earned - an adviser who also teaches is
// the ordinary case here, not a special one.
function itemsFor({ role, advisesCount, teachesCount }) {
  const keys = new Set(ROLE_ITEMS[role] || []);
  if (advisesCount > 0) ADVISER_ITEMS.forEach((key) => keys.add(key));
  if (teachesCount > 0) TEACHER_ITEMS.forEach((key) => keys.add(key));
  return keys;
}

// The queue itself.
//
// Returns { tasks, clearedAt }. `tasks` carries every item this person is
// eligible for INCLUDING the ones that count zero, because "nothing to
// finalize" is information an adviser wants rather than an empty space, and
// the frontend shows the cleared ones quietly below the live ones. An empty
// `tasks` array means this role has no queue at all (students),
// which is a different thing from being caught up.
async function getTaskQueue(user) {
  const today = todayInSchoolTimezone();
  const period = await gradingPeriodModel.findCurrentWithSchoolYear(today);

  // Students hold neither assignment and own nothing on this list; asking
  // the database what they advise would only ever come back empty.
  if (user.role === 'student') return { tasks: [], gradingPeriodName: period?.name || null };

  const [advised, taught] = await Promise.all([
    sectionModel.listSectionsByAdviser(user.id),
    classOfferingModel.listByTeacher(user.id),
  ]);
  const keys = itemsFor({ role: user.role, advisesCount: advised.length, teachesCount: taught.length });

  // Every count that needs a grading period is skipped entirely outside
  // one, rather than reported as zero: between terms there is no period
  // to count against, and "0 grades to finalize" would read as caught up
  // when the truth is that the question does not apply.
  const counts = {};
  if (period) {
    if (keys.has('finalize_grades')) counts.finalize_grades = await countGradesToFinalize(user.id, period.id);
    if (keys.has('submit_grades')) counts.submit_grades = await countClassesMissingGrades(user.id, period);
    if (keys.has('resubmit_rejected_grades')) {
      counts.resubmit_rejected_grades = await countRejectedGrades(user.id, period.id);
    }
    if (keys.has('verify_grades')) counts.verify_grades = await dashboardModel.countSubmittedGrades(period.id);
    if (keys.has('flagged_without_support')) {
      counts.flagged_without_support = await countFlaggedWithoutSupport(user, period.id);
    }
  }
  if (keys.has('mark_daily_attendance') && isSchoolDay(today, period)) {
    counts.mark_daily_attendance = await countSectionsMissingTodaysRegister(user.id, today);
  }
  if (keys.has('stale_interventions')) counts.stale_interventions = await countStaleInterventions(user, today);
  if (keys.has('pending_student_accounts')) counts.pending_student_accounts = await countStudentsWithoutAccounts();
  if (keys.has('temporary_passwords')) {
    counts.temporary_passwords = (await userModel.countAccounts()).pending_first_login;
  }

  // Outstanding work first, then by urgency, then the largest pile - so the
  // top of the list is always the thing most worth opening.
  const tasks = Object.entries(counts)
    .map(([key, count]) => ({ key, count, ...QUEUE_ITEMS[key] }))
    .sort((a, b) => {
      if ((a.count > 0) !== (b.count > 0)) return a.count > 0 ? -1 : 1;
      if (a.urgency !== b.urgency) return URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      return b.count - a.count;
    });

  return { tasks, gradingPeriodName: period?.name || null };
}

module.exports = { getTaskQueue };
