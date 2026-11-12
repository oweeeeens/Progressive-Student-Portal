// What "what needs you today" means, item by item.
//
// The home page's lead content is a list of things the signed-in person can
// actually clear, each with a count and a link to the page that clears it.
// This file is the vocabulary: every item's title, the sentence that says
// exactly what its count includes, the page it links to, and which area of
// the work it belongs to. The COUNTING lives in
// models/dashboardQueueModel.js, and nothing there writes a label.
//
// Separated this way for the same reason the risk thresholds are
// (CLAUDE.md, "Separate config from logic"): the client reading this file
// should be able to check that what the dashboard claims matches what the
// school actually expects of each role, without reading a single query.
//
// FIELDS
//   title      - verb-led. The task, not the data ("Finalize verified
//                grades", never "Verified grades").
//   detail     - ONE SHORT CLAUSE stating what the count includes. Every
//                word of it is checked against the query that produces the
//                number, because a task list that overstates its own scope
//                is worse than no task list — but it is read at a glance on
//                a row, not studied, so the longer reasoning stays in the
//                comments beside each query in the model rather than being
//                set in 12px type next to a number.
//   unit       - the noun the count counts, singular. The frontend
//                pluralises it; it is here so "3 grades" and "3 sections"
//                can never both be rendered as "3 items".
//   href       - where the work is done.
//   linkLabel  - what that page is called in the navigation, so the link
//                text matches the page the reader lands on.
//   area       - which module hue the item wears (see index.css's module
//                palette). Deliberately NOT the risk ramp: those colours
//                mean "this learner is in trouble" and must never be spent
//                on "you have paperwork".
//   urgency    - 'now' is work that is already waiting on this person;
//                'routine' is work that is simply due at some point. It
//                changes the ORDER and the emphasis, never the colour, so
//                nothing here competes with a risk badge.

// How long an intervention may sit in Open or Monitoring before the
// dashboard asks about it. Two school weeks: long enough that a parent
// conference arranged for "next week" is not nagged about, short enough
// that a case nobody picked up surfaces inside the same grading period.
const STALE_INTERVENTION_DAYS = 14;

const QUEUE_ITEMS = {
  finalize_grades: {
    title: 'Finalize verified grades',
    detail: 'Verified by the principal this term, not yet in the official record.',
    unit: 'grade',
    href: '/grades/finalize',
    linkLabel: 'Finalize Grades',
    area: 'grades',
    urgency: 'now',
  },
  mark_daily_attendance: {
    title: "Mark today's register",
    detail: 'Sections you advise with no register filed today. Counted per section, not per learner.',
    unit: 'section',
    href: '/attendance/daily',
    linkLabel: 'Daily Attendance',
    area: 'attendance',
    urgency: 'now',
  },
  submit_grades: {
    title: 'Record scores for this term',
    detail: 'Classes you teach that run in this term with no computed grade submitted yet.',
    unit: 'class',
    href: '/grades/entry',
    linkLabel: 'Class Record',
    area: 'grades',
    urgency: 'routine',
  },
  resubmit_rejected_grades: {
    title: 'Resubmit returned grades',
    detail: 'Sent back by the principal. These stay out of the official record until you resubmit.',
    unit: 'grade',
    href: '/grades/entry',
    linkLabel: 'Class Record',
    area: 'grades',
    urgency: 'now',
  },
  verify_grades: {
    title: 'Verify submitted grades',
    detail: 'Submitted by subject teachers, school-wide. Nothing reaches an adviser until you pass it on.',
    unit: 'grade',
    href: '/grades/verify',
    linkLabel: 'Verify Grades',
    area: 'grades',
    urgency: 'now',
  },
  flagged_without_support: {
    title: 'Log support for flagged learners',
    detail: 'Flagged this term with no intervention logged against that assessment. Includes Low risk.',
    unit: 'learner',
    href: '/academic-progress',
    linkLabel: 'Academic Progress Tracking',
    area: 'progress',
    urgency: 'now',
  },
  stale_interventions: {
    title: 'Follow up on open interventions',
    detail: `Open or Monitoring more than ${STALE_INTERVENTION_DAYS} days after they were logged. Escalated is left out.`,
    unit: 'intervention',
    href: '/interventions',
    linkLabel: 'Interventions',
    area: 'progress',
    urgency: 'routine',
  },
  pending_student_accounts: {
    title: 'Create student portal accounts',
    detail: 'Active student records with no portal login yet.',
    unit: 'record',
    href: '/users?tab=pending',
    linkLabel: 'Pending Student Accounts',
    area: 'records',
    urgency: 'routine',
  },
  temporary_passwords: {
    title: 'Chase up temporary passwords',
    detail: 'Created but never signed into — the temporary password is still unchanged.',
    unit: 'account',
    href: '/users',
    linkLabel: 'User Management',
    area: 'admin',
    urgency: 'routine',
  },
};

// Items a role gets purely by being that role. Everything assignment-based
// (an adviser's register, a teacher's classes) is decided by what the person
// is actually assigned to, not by this map - see the model.
//
// The principal appears with one item only, and that is the point: CLAUDE.md
// is explicit that they approve grades and read the rollup, while the
// per-learner follow-up belongs to the learner's adviser alone (interventions
// are adviser-only), which is why the guidance counselor has no items here.
// Students appear nowhere: nothing in this list is a learner's job.
const ROLE_ITEMS = {
  principal: ['verify_grades'],
  admin: ['verify_grades', 'pending_student_accounts', 'temporary_passwords', 'flagged_without_support', 'stale_interventions'],
  registrar: ['pending_student_accounts'],
};

// Items earned by advising at least one section.
const ADVISER_ITEMS = ['finalize_grades', 'mark_daily_attendance', 'flagged_without_support', 'stale_interventions'];

// Items earned by teaching at least one class offering.
const TEACHER_ITEMS = ['submit_grades', 'resubmit_rejected_grades'];

// Work already waiting on someone sorts above work that is merely due.
const URGENCY_ORDER = { now: 0, routine: 1 };

module.exports = {
  STALE_INTERVENTION_DAYS,
  QUEUE_ITEMS,
  ROLE_ITEMS,
  ADVISER_ITEMS,
  TEACHER_ITEMS,
  URGENCY_ORDER,
};
