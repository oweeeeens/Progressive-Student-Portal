// The demo school, as plain data.
//
// Both seed scripts read this one file: seedSampleData.js writes the
// structure straight to the database, and seedDemoAcademicData.js drives the
// real API to produce grades, attendance, interventions and announcements on
// top of it. Keeping the roster in one place is what stops the two from
// drifting — the academic script looks everything up by LRN, section name and
// subject code rather than by hardcoded id.
//
// Nothing here touches the database or the network. It is a description of a
// small senior high school, chosen so that every module in the portal has
// something real to show.

// Every demo account signs in with this. Fine for a demo on a stopped
// service; see DEPLOYMENT.md before this is ever pointed at real students.
const DEMO_PASSWORD = 'Password123!';

// One account per role, so each sidebar can be demonstrated as itself.
// `state` marks the two accounts that exist to show User Management's own
// states rather than to be logged into.
const STAFF = [
  { email: 'principal@studentportal.local', fullName: 'Remedios T. Alcantara', role: 'principal' },
  { email: 'registrar@studentportal.local', fullName: 'Nenita B. Villamor', role: 'registrar' },
  { email: 'guidance@studentportal.local', fullName: 'Josefina R. Delos Santos', role: 'guidance_counselor' },
  { email: 'ict@studentportal.local', fullName: 'Arnel P. Bautista', role: 'ict_faculty' },
  { email: 'adviser@studentportal.local', fullName: 'Maricel S. Robles', role: 'adviser' },
  { email: 'adviser2@studentportal.local', fullName: 'Edgardo L. Ramos', role: 'adviser' },
  { email: 'adviser3@studentportal.local', fullName: 'Teresita M. Aquino', role: 'adviser' },
  { email: 'subject_teacher@studentportal.local', fullName: 'Rogelio C. Mendoza', role: 'subject_teacher' },
  { email: 'teacher2@studentportal.local', fullName: 'Lourdes V. Pascual', role: 'subject_teacher' },
  { email: 'teacher3@studentportal.local', fullName: 'Benjamin O. Cruz', role: 'subject_teacher' },
  // Left deactivated: User Management's Active/Inactive filter and the
  // "historical records stay intact" rule need a deactivated account to show.
  { email: 'former.teacher@studentportal.local', fullName: 'Corazon D. Silva', role: 'subject_teacher', state: 'inactive' },
  // Never signed in: shows the "Pending first login" badge and the forced
  // password change the account-creation flow promises.
  { email: 'new.teacher@studentportal.local', fullName: 'Ferdinand G. Lazaro', role: 'subject_teacher', state: 'pending-first-login' },
];

const SECTIONS = [
  { name: 'STEM A', strand: 'STEM', gradeLevel: 11, adviser: 'adviser@studentportal.local' },
  { name: 'STEM B', strand: 'STEM', gradeLevel: 11, adviser: 'adviser2@studentportal.local' },
  { name: 'ABM A', strand: 'ABM', gradeLevel: 11, adviser: 'adviser3@studentportal.local' },
];

// Grade 11 core subjects, plus one specialised subject per strand so the
// Class Offerings page shows that not every section takes every subject.
const SUBJECTS = [
  { code: 'MATH11', name: 'General Mathematics', strands: ['STEM', 'ABM'], teacher: 'subject_teacher@studentportal.local' },
  { code: 'ENG11', name: 'Oral Communication', strands: ['STEM', 'ABM'], teacher: 'teacher2@studentportal.local' },
  { code: 'SCI11', name: 'Earth and Life Science', strands: ['STEM', 'ABM'], teacher: 'teacher3@studentportal.local' },
  { code: 'PEH11', name: 'Physical Education and Health', strands: ['STEM', 'ABM'], teacher: 'teacher2@studentportal.local' },
  { code: 'UCSP11', name: 'Understanding Culture, Society and Politics', strands: ['STEM', 'ABM'], teacher: 'teacher3@studentportal.local' },
  { code: 'PERDEV11', name: 'Personal Development', strands: ['STEM', 'ABM'], teacher: 'subject_teacher@studentportal.local' },
  { code: 'CHEM11', name: 'General Chemistry 1', strands: ['STEM'], teacher: 'teacher3@studentportal.local' },
  { code: 'ABM11', name: 'Business Mathematics', strands: ['ABM'], teacher: 'teacher2@studentportal.local' },
];

// --- How a student performs -------------------------------------------------
// The risk formula reads two series per student: the average of their
// FINALIZED grades per period, and their daily attendance rate per period.
// Trend is (latest − earliest) ÷ number of periods, so across two quarters a
// drop has to exceed 10 points to breach the −5/period decline threshold.
// These profiles are chosen against those exact rules so the roster lands in
// every band rather than clustering.
const GRADE_PROFILES = {
  excellent: { q1: 93, q2: 95 }, // high and rising
  improving: { q1: 78, q2: 88 }, // +5/period and still under 90: earns
  // recognition on the trend alone, which is the band rule's second clause
  strong: { q1: 88, q2: 91 }, // crosses into Outstanding
  solid: { q1: 85, q2: 84 }, // comfortable, flat
  average: { q1: 79, q2: 81 }, // unremarkable, fine
  slipping: { q1: 86, q2: 74 }, // −6/period AND below passing: two grade flags
  struggling: { q1: 78, q2: 70 }, // −4/period, so only the low-grade flag
  failing: { q1: 72, q2: 60 }, // −6/period and well below passing
};

// Attendance per quarter, as the number of school days attended out of the
// ten recorded. Two separate checks read these, and both have to be kept in
// mind: the RATE (flagged below 90%) and the TREND, (latest − earliest) ÷ 2
// across the two quarters, flagged at ≤ −5 percentage points per period.
//
// That second check is easy to trip by accident. 10 days then 9 is a rate of
// 90%, which clears the threshold — but it is a −5/period trend, which does
// not. So `good` is deliberately FLAT at 9 days: a student who simply misses
// one day a quarter must come out with no flags at all, or most of the roster
// reads as at-risk for nothing. `dipping` is the same 90% rate WITH the drop,
// kept as its own profile so that case is shown on purpose rather than by
// mistake.
const ATTENDANCE_PROFILES = {
  perfect: { q1: 10, q2: 10 },
  good: { q1: 9, q2: 9 }, // 90% flat: clears the required rate, no trend
  dipping: { q1: 10, q2: 9 }, // 90% but −5/period: trend flag only
  spotty: { q1: 8, q2: 8 }, // 80%: below the required rate, flat
  declining: { q1: 10, q2: 7 }, // 100% → 70%: low AND falling fast
  poor: { q1: 7, q2: 4 }, // 70% → 40%: the worst case on the roster
};

// `login: true` gives the student a portal account, so the student view can
// be shown from more than one band. `flags` are the descriptive learner
// fields — reporting only, never scored (CLAUDE.md).
const STUDENTS = [
  // --- STEM A ---------------------------------------------------------------
  { lrn: '100000000001', first: 'Ana', middle: 'Lim', last: 'Reyes', sex: 'F', section: 'STEM A', grades: 'excellent', attendance: 'perfect', email: 'ana.reyes@example.com', login: true },
  { lrn: '100000000002', first: 'Ben', middle: 'Uy', last: 'Cruz', sex: 'M', section: 'STEM A', grades: 'strong', attendance: 'good', email: 'ben.cruz@example.com' },
  { lrn: '100000000003', first: 'Clarisse', middle: 'Bautista', last: 'Domingo', sex: 'F', section: 'STEM A', grades: 'solid', attendance: 'perfect', email: 'clarisse.domingo@example.com' },
  { lrn: '100000000004', first: 'Daniel', middle: 'Ocampo', last: 'Flores', sex: 'M', section: 'STEM A', grades: 'average', attendance: 'good', email: 'daniel.flores@example.com' },
  { lrn: '100000000005', first: 'Elaine', middle: 'Santos', last: 'Mercado', sex: 'F', section: 'STEM A', grades: 'average', attendance: 'spotty', email: 'elaine.mercado@example.com', flags: { is4ps: true } },
  { lrn: '100000000006', first: 'Francis', middle: 'Dela Cruz', last: 'Navarro', sex: 'M', section: 'STEM A', grades: 'slipping', attendance: 'good', email: 'francis.navarro@example.com' },
  { lrn: '100000000007', first: 'Gillian', middle: 'Panganiban', last: 'Robles', sex: 'F', section: 'STEM A', grades: 'solid', attendance: 'good' }, // no email on file
  { lrn: '100000000008', first: 'Harold', middle: 'Villanueva', last: 'Sarmiento', sex: 'M', section: 'STEM A', grades: 'struggling', attendance: 'spotty', email: 'harold.sarmiento@example.com', flags: { isPwd: true } },
  { lrn: '100000000009', first: 'Irene', middle: 'Castillo', last: 'Tolentino', sex: 'F', section: 'STEM A', grades: 'strong', attendance: 'perfect', email: 'irene.tolentino@example.com' },
  { lrn: '100000000010', first: 'Jerome', middle: 'Aguilar', last: 'Velasco', sex: 'M', section: 'STEM A', grades: 'average', attendance: 'dipping', email: 'jerome.velasco@example.com' },
  { lrn: '100000000011', first: 'Katrina', middle: 'Salazar', last: 'Yabut', sex: 'F', section: 'STEM A', grades: 'solid', login: true, attendance: 'good', email: 'katrina.yabut@example.com' },
  { lrn: '100000000012', first: 'Luis', middle: 'Fernandez', last: 'Zamora', sex: 'M', section: 'STEM A', grades: 'excellent', attendance: 'perfect', email: 'luis.zamora@example.com' },

  // --- STEM B ---------------------------------------------------------------
  // Carlo keeps the original student login and the worst standing on the
  // roster: the walkthrough of the risk explanation is built around him.
  { lrn: '100000000013', first: 'Carlo', middle: 'Reyes', last: 'Santos', sex: 'M', section: 'STEM B', grades: 'failing', attendance: 'declining', login: true, loginEmail: 'student@studentportal.local' },
  { lrn: '100000000014', first: 'Dina', middle: 'Garcia', last: 'Lopez', sex: 'F', section: 'STEM B', grades: 'strong', attendance: 'good', email: 'dina.lopez@example.com' },
  { lrn: '100000000015', first: 'Emilio', middle: 'Torres', last: 'Abad', sex: 'M', section: 'STEM B', grades: 'average', attendance: 'good', email: 'emilio.abad@example.com' },
  { lrn: '100000000016', first: 'Faye', middle: 'Mariano', last: 'Bernardo', sex: 'F', section: 'STEM B', grades: 'slipping', attendance: 'spotty', email: 'faye.bernardo@example.com' },
  { lrn: '100000000017', first: 'Gabriel', middle: 'Ignacio', last: 'Carpio', sex: 'M', section: 'STEM B', grades: 'improving', login: true, attendance: 'perfect', email: 'gabriel.carpio@example.com' },
  { lrn: '100000000018', first: 'Hannah', middle: 'Legaspi', last: 'Duran', sex: 'F', section: 'STEM B', grades: 'excellent', attendance: 'perfect', email: 'hannah.duran@example.com', login: true },
  { lrn: '100000000019', first: 'Ivan', middle: 'Macaraeg', last: 'Espiritu', sex: 'M', section: 'STEM B', grades: 'struggling', attendance: 'poor', email: 'ivan.espiritu@example.com', flags: { is4ps: true } },
  { lrn: '100000000020', first: 'Jasmine', middle: 'Obispo', last: 'Fajardo', sex: 'F', section: 'STEM B', grades: 'average', attendance: 'good', email: 'jasmine.fajardo@example.com' },
  { lrn: '100000000021', first: 'Kevin', middle: 'Rivera', last: 'Gutierrez', sex: 'M', section: 'STEM B', grades: 'solid', attendance: 'dipping', email: 'kevin.gutierrez@example.com' },
  { lrn: '100000000022', first: 'Liza', middle: 'Soriano', last: 'Hernandez', sex: 'F', section: 'STEM B', grades: 'strong', attendance: 'good', email: 'liza.hernandez@example.com' },
  { lrn: '100000000023', first: 'Marco', middle: 'Trinidad', last: 'Ibarra', sex: 'M', section: 'STEM B', grades: 'average', attendance: 'spotty', email: 'marco.ibarra@example.com' },
  { lrn: '100000000024', first: 'Nicole', middle: 'Agustin', last: 'Jimenez', sex: 'F', section: 'STEM B', grades: 'solid', attendance: 'good', email: 'nicole.jimenez@example.com', enrollmentStatus: 'transferred' },

  // --- ABM A ----------------------------------------------------------------
  { lrn: '100000000025', first: 'Eve', middle: 'Ramos', last: 'Garcia', sex: 'F', section: 'ABM A', grades: 'strong', attendance: 'perfect', email: 'eve.garcia@example.com' },
  { lrn: '100000000026', first: 'Fred', middle: 'Bonifacio', last: 'Torres', sex: 'M', section: 'ABM A', grades: 'improving', attendance: 'good', email: 'fred.torres@example.com' },
  { lrn: '100000000027', first: 'Grace', middle: 'Cordero', last: 'Lim', sex: 'F', section: 'ABM A', grades: 'excellent', attendance: 'perfect', email: 'grace.lim@example.com' },
  { lrn: '100000000028', first: 'Hector', middle: 'Dizon', last: 'Marquez', sex: 'M', section: 'ABM A', grades: 'slipping', attendance: 'declining', email: 'hector.marquez@example.com' },
  { lrn: '100000000029', first: 'Isabel', middle: 'Enriquez', last: 'Nolasco', sex: 'F', section: 'ABM A', grades: 'solid', attendance: 'good', email: 'isabel.nolasco@example.com' },
  { lrn: '100000000030', first: 'Jay', middle: 'Fuentes', last: 'Ortega', sex: 'M', section: 'ABM A', grades: 'struggling', attendance: 'spotty', email: 'jay.ortega@example.com', flags: { isAlsGraduate: true } },
  { lrn: '100000000031', first: 'Karen', middle: 'Gonzales', last: 'Padilla', sex: 'F', section: 'ABM A', grades: 'average', attendance: 'good', email: 'karen.padilla@example.com' },
  { lrn: '100000000032', first: 'Lance', middle: 'Herrera', last: 'Quijano', sex: 'M', section: 'ABM A', grades: 'solid', attendance: 'good' }, // no email on file
  { lrn: '100000000033', first: 'Mia', middle: 'Isidro', last: 'Rosales', sex: 'F', section: 'ABM A', grades: 'strong', attendance: 'good', email: 'mia.rosales@example.com' },
  { lrn: '100000000034', first: 'Noel', middle: 'Jacinto', last: 'Suarez', sex: 'M', section: 'ABM A', grades: 'failing', attendance: 'spotty', email: 'noel.suarez@example.com', flags: { is4ps: true, isPwd: true } },
  { lrn: '100000000035', first: 'Olivia', middle: 'Katigbak', last: 'Tan', sex: 'F', section: 'ABM A', grades: 'excellent', attendance: 'good', email: 'olivia.tan@example.com' },
  { lrn: '100000000036', first: 'Paolo', middle: 'Lacson', last: 'Uy', sex: 'M', section: 'ABM A', grades: 'average', attendance: 'good', email: 'paolo.uy@example.com', enrollmentStatus: 'dropped' },
];

// --- The school calendar ----------------------------------------------------
// Attendance endpoints resolve the grading period FROM THE DATE, so every
// date below has to fall inside its quarter's range or the record lands in
// the wrong period. Ten school days per quarter: enough for a rate to be
// meaningful, few enough to seed quickly.
const PERIOD_DATES = {
  Q1: [
    '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-08',
    '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-15',
  ],
  Q2: [
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
  ],
};

// Which subjects also keep their own per-period attendance. Not every teacher
// does, which is the point: the student's "Attendance by Subject" table is
// meant to differ from the daily homeroom record.
const SUBJECT_ATTENDANCE_CODES = ['MATH11', 'ENG11', 'SCI11'];

// --- Work left deliberately unfinished --------------------------------------
// Each page in the grade workflow reads a different status, so a dataset
// where every grade is already finalized leaves Verify Grades and Finalize
// Grades empty — which is exactly what happened before this existed.
//
// These lanes apply to the CURRENT quarter, not a future one. Verify Grades
// auto-selects whichever grading period contains today (see
// VerifyGradesPage.jsx), so work parked in a later quarter would be invisible
// until someone changed a dropdown. The seed asks the API which period is
// current and applies the lanes there.
//
// Split by SECTION because finalizing acts on a whole section and period at
// once: two lanes cannot share one section. Every other subject in these
// sections still reaches `finalized`, so the risk engine has its official
// record either way.
const CURRENT_PERIOD_LANES = {
  // The principal has a queue to work through, and one subject has already
  // come back rejected so the teacher's resubmit path is visible too.
  'STEM A': { submitted: ['MATH11'], rejected: ['ENG11'] },
  // The adviser has verified grades waiting to be entered into the official
  // record.
  'STEM B': { verified: ['SCI11', 'PEH11'] },
  // No grades at all for one subject: the subject teacher enters a class
  // from scratch, on a sheet that starts blank.
  'ABM A': { ungraded: ['ABM11'] },
};

// Support already logged against at-risk students, one in each status so the
// Interventions page shows its whole vocabulary. Keyed by LRN.
const INTERVENTIONS = [
  { lrn: '100000000013', type: 'counseling_referral', status: 'open', notes: 'Referred to guidance after Q2 grades were finalized. Parent contacted; meeting to be scheduled.' },
  { lrn: '100000000013', type: 'attendance_follow_up', status: 'monitoring', notes: 'Home visit conducted. Guardian reports transportation difficulty; adviser checking in weekly.' },
  { lrn: '100000000019', type: 'parent_conference', status: 'monitoring', notes: 'Conference held with guardian. Agreed on a daily attendance check with the adviser.' },
  { lrn: '100000000028', type: 'tutoring_referral', status: 'open', notes: 'Referred to peer tutoring for Business Mathematics after a 12-point drop.' },
  { lrn: '100000000034', type: 'tutoring_referral', status: 'escalated', notes: 'Tutoring attended irregularly and marks continued to fall. Raised to the guidance office.' },
  { lrn: '100000000008', type: 'attendance_follow_up', status: 'resolved', notes: 'Attendance recovered after the guardian meeting. Closed.' },
];

const ANNOUNCEMENTS = [
  {
    title: 'Second Quarter Examination Schedule',
    body:
      'Second quarter examinations will run from 8 to 12 December 2026. The schedule per subject is attached. ' +
      'Students are reminded to settle any outstanding requirements with their advisers before the examination week begins.',
    attachment: 'Q2-Examination-Schedule.pdf',
  },
  {
    title: 'Parent-Teacher Conference',
    body:
      'The quarterly parent-teacher conference is set for Saturday, 14 November 2026, 8:00 AM at the school gymnasium. ' +
      'Advisers will release the second quarter report cards during the conference. Parents of students flagged for academic follow-up will be met individually.',
  },
  {
    title: 'Portal Accounts for Grade 11',
    body:
      'Grade 11 students may now sign in to the Student Portal to view their grades, attendance and standing. ' +
      'If you have not received your account details, please see the registrar. Passwords must be changed on first sign-in.',
  },
];

module.exports = {
  DEMO_PASSWORD,
  STAFF,
  SECTIONS,
  SUBJECTS,
  GRADE_PROFILES,
  ATTENDANCE_PROFILES,
  STUDENTS,
  PERIOD_DATES,
  SUBJECT_ATTENDANCE_CODES,
  CURRENT_PERIOD_LANES,
  INTERVENTIONS,
  ANNOUNCEMENTS,
};
