// The demo school, as plain data.
//
// Both seed scripts read this one file: seedSampleData.js writes the
// structure straight to the database, and seedDemoAcademicData.js drives the
// real API to produce grades, attendance and interventions on top of it. Keeping the roster in one place is what stops the two from
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

// The school year's three TERMS, in one place.
//
// Both seed scripts read this: seedSampleData.js creates the rows and
// seedDemoAcademicData.js decides which terms to generate marks for. The
// names used to be a literal list in each of them, which is two places for
// "Q1" to become "Term 1" and only one of them to be remembered.
//
// `sequenceNumber` is load-bearing beyond ordering: a class offering that
// runs for a single term names it 'term1'/'term2'/'term3', and that is
// matched against this number (backend/config/academicTerms.js).
const PERIODS = [
  { name: 'Term 1', sequenceNumber: 1, startDate: '2026-06-01', endDate: '2026-09-15' },
  { name: 'Term 2', sequenceNumber: 2, startDate: '2026-09-16', endDate: '2026-12-31' },
  { name: 'Term 3', sequenceNumber: 3, startDate: '2027-01-01', endDate: '2027-03-31' },
];

// The terms the demo generates marks for. Term 3 is deliberately left empty:
// it is in the future relative to the demo's own calendar, and a school
// part-way through its year is the state the dashboard and the grade views
// are actually meant to be read in.
const GRADED_PERIODS = ['Term 1', 'Term 2'];

const SECTIONS = [
  { name: 'STEM A', strand: 'STEM', gradeLevel: 11, adviser: 'adviser@studentportal.local' },
  { name: 'STEM B', strand: 'STEM', gradeLevel: 11, adviser: 'adviser2@studentportal.local' },
  { name: 'ABM A', strand: 'ABM', gradeLevel: 11, adviser: 'adviser3@studentportal.local' },
  // The Grade 12 section exists so the per-term timetable can be shown at
  // all. Until it did, the seed held three Grade 11 sections, eight Grade 11
  // subjects and nothing that ran for only part of the year — so "subjects
  // change every term except the specialized one" was describable but not
  // demonstrable.
  { name: 'STEM 12-A', strand: 'STEM', gradeLevel: 12, adviser: 'adviser2@studentportal.local' },
];

// Grade 11 core subjects, plus one specialised subject per strand so the
// Class Offerings page shows that not every section takes every subject.
//
// `category` is DepEd's grouping (core / applied / specialized) and
// `gradeLevel` says which year takes it. `term` is how long the class runs:
// Grade 11 classes run all three terms, Grade 12 core and applied classes
// change every term, and a specialized subject runs all three in both grade
// levels — which is the rule this data exists to demonstrate.
const SUBJECTS = [
  { code: 'MATH11', name: 'General Mathematics', gradeLevel: 11, category: 'core', term: 'full_year', strands: ['STEM', 'ABM'], teacher: 'subject_teacher@studentportal.local' },
  { code: 'ENG11', name: 'Oral Communication', gradeLevel: 11, category: 'core', term: 'full_year', strands: ['STEM', 'ABM'], teacher: 'teacher2@studentportal.local' },
  { code: 'SCI11', name: 'Earth and Life Science', gradeLevel: 11, category: 'core', term: 'full_year', strands: ['STEM', 'ABM'], teacher: 'teacher3@studentportal.local' },
  { code: 'PEH11', name: 'Physical Education and Health', gradeLevel: 11, category: 'core', term: 'full_year', strands: ['STEM', 'ABM'], teacher: 'teacher2@studentportal.local' },
  { code: 'UCSP11', name: 'Understanding Culture, Society and Politics', gradeLevel: 11, category: 'core', term: 'full_year', strands: ['STEM', 'ABM'], teacher: 'teacher3@studentportal.local' },
  { code: 'PERDEV11', name: 'Personal Development', gradeLevel: 11, category: 'core', term: 'full_year', strands: ['STEM', 'ABM'], teacher: 'subject_teacher@studentportal.local' },
  { code: 'CHEM11', name: 'General Chemistry 1', gradeLevel: 11, category: 'specialized', term: 'full_year', strands: ['STEM'], teacher: 'teacher3@studentportal.local' },
  { code: 'ABM11', name: 'Business Mathematics', gradeLevel: 11, category: 'specialized', term: 'full_year', strands: ['ABM'], teacher: 'teacher2@studentportal.local' },

  // --- Grade 12 -------------------------------------------------------------
  // A different subject in each of the three terms, plus one specialized
  // subject running across all of them — which is the school's own
  // description of Grade 12 ("nag iiba iba kada term ung subject maliban sa
  // mga specialized"). On the learner's grade view that reads as: a
  // different subject list in each term tab, with Research in Daily Life
  // present in all three.
  //
  // Two subjects share Term 2 on purpose: a term is not limited to one
  // subject, and a demo where each term held exactly one would make the
  // rule look narrower than it is.
  { code: 'PHILO12', name: 'Introduction to the Philosophy of the Human Person', gradeLevel: 12, category: 'core', term: 'term1', strands: ['STEM'], teacher: 'teacher3@studentportal.local' },
  { code: 'MIL12', name: 'Media and Information Literacy', gradeLevel: 12, category: 'core', term: 'term2', strands: ['STEM'], teacher: 'teacher2@studentportal.local' },
  { code: 'ENTREP12', name: 'Entrepreneurship', gradeLevel: 12, category: 'applied', term: 'term2', strands: ['STEM'], teacher: 'teacher2@studentportal.local' },
  { code: 'INQ12', name: 'Inquiries, Investigations and Immersion', gradeLevel: 12, category: 'applied', term: 'term3', strands: ['STEM'], teacher: 'subject_teacher@studentportal.local' },
  { code: 'RDL12', name: 'Research in Daily Life 2', gradeLevel: 12, category: 'specialized', term: 'full_year', strands: ['STEM'], teacher: 'teacher3@studentportal.local' },
];

// Who teaches a given subject TO A GIVEN SECTION, overriding SUBJECTS'
// default teacher. Keyed `'<section>|<subject code>'`.
//
// This exists for one case worth demonstrating: the STEM A adviser also
// teaches Personal Development to ABM A. That is how the school actually
// staffs its timetable — a teacher advises one section and teaches subjects
// to others — and until now no seeded user held both kinds of assignment,
// so the behaviour could not be exercised or demoed at all. It is also the
// exact shape that used to break: they could submit those ABM A students'
// grades and then not be allowed to open their records.
const TEACHER_OVERRIDES = {
  'ABM A|PERDEV11': 'adviser@studentportal.local',
  // Every adviser teaches something, in a section they do NOT advise.
  //
  // Until this, only the first adviser did, so the dual-hat case — the one
  // CLAUDE.md calls the ordinary way this school staffs its timetable — was
  // demonstrable on exactly one account out of three. The other two had no
  // Enter Grades in their sidebar, which was the
  // navigation telling the truth about data that was not.
  //
  // Deliberately a section they do not advise: an adviser teaching their own
  // advisory class would exercise nothing the single-hat case does not.
  'STEM A|UCSP11': 'adviser2@studentportal.local',
  'STEM B|PEH11': 'adviser3@studentportal.local',
};

// --- How a student performs -------------------------------------------------
// The risk formula reads two series per student: the average of their
// FINALIZED grades per period, and their daily attendance rate per period.
// Trend is (latest − earliest) ÷ number of periods, so across two terms a
// drop has to exceed 10 points to breach the −5/period decline threshold.
// These profiles are chosen against those exact rules so the roster lands in
// every band rather than clustering.
// KEYED BY THE TERM'S SEQUENCE NUMBER, not by its name. The generator used
// to look these up as `periodKey.toLowerCase()` against `q1`/`q2` keys,
// which worked only while the periods happened to be called Q1 and Q2 —
// renaming them to Term 1/2 turned every lookup into `undefined` and every
// grade into NaN. A period's position in the year is the one thing about it
// that is neither free text nor the school's to change.
const GRADE_PROFILES = {
  excellent: { 1: 93, 2: 95 }, // high and rising
  improving: { 1: 78, 2: 88 }, // +5/period and still under 90: earns
  // recognition on the trend alone, which is the band rule's second clause
  strong: { 1: 88, 2: 91 }, // crosses into Outstanding
  solid: { 1: 85, 2: 84 }, // comfortable, flat
  average: { 1: 79, 2: 81 }, // unremarkable, fine
  slipping: { 1: 86, 2: 74 }, // −6/period AND below passing: two grade flags
  struggling: { 1: 78, 2: 70 }, // −4/period, so only the low-grade flag
  failing: { 1: 72, 2: 60 }, // −6/period and well below passing
};

// Attendance per term, as the number of school days attended out of the
// ten recorded, keyed by sequence number like the grade profiles above.
// Two separate checks read these, and both have to be kept in mind: the
// RATE (flagged below 90%) and the TREND, (latest − earliest) ÷ 2 across the
// two terms, flagged at ≤ −5 percentage points per period.
//
// That second check is easy to trip by accident. 10 days then 9 is a rate of
// 90%, which clears the threshold — but it is a −5/period trend, which does
// not. So `good` is deliberately FLAT at 9 days: a student who simply misses
// one day a term must come out with no flags at all, or most of the roster
// reads as at-risk for nothing. `dipping` is the same 90% rate WITH the drop,
// kept as its own profile so that case is shown on purpose rather than by
// mistake.
const ATTENDANCE_PROFILES = {
  perfect: { 1: 10, 2: 10 },
  good: { 1: 9, 2: 9 }, // 90% flat: clears the required rate, no trend
  dipping: { 1: 10, 2: 9 }, // 90% but −5/period: trend flag only
  spotty: { 1: 8, 2: 8 }, // 80%: below the required rate, flat
  declining: { 1: 10, 2: 7 }, // 100% → 70%: low AND falling fast
  poor: { 1: 7, 2: 4 }, // 70% → 40%: the worst case on the roster
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

  // --- STEM 12-A --------------------------------------------------------------
  // A small Grade 12 cohort, enough to show the per-semester timetable and to
  // put a learner in each band. One has a login, so the term tabs on the
  // student's own grade view can be demonstrated from the inside — which is
  // where the difference between Q1 and Q3 subjects is actually visible.
  { lrn: '100000000037', first: 'Rafael', middle: 'Mercado', last: 'Abad', sex: 'M', section: 'STEM 12-A', grades: 'excellent', attendance: 'perfect', email: 'rafael.abad@example.com', login: true },
  { lrn: '100000000038', first: 'Sofia', middle: 'Nery', last: 'Bermudez', sex: 'F', section: 'STEM 12-A', grades: 'strong', attendance: 'good', email: 'sofia.bermudez@example.com' },
  { lrn: '100000000039', first: 'Teodoro', middle: 'Ongpin', last: 'Carpio', sex: 'M', section: 'STEM 12-A', grades: 'average', attendance: 'good', email: 'teodoro.carpio@example.com' },
  { lrn: '100000000040', first: 'Ursula', middle: 'Pineda', last: 'Dimaculangan', sex: 'F', section: 'STEM 12-A', grades: 'improving', attendance: 'good', email: 'ursula.dimaculangan@example.com' },
  { lrn: '100000000041', first: 'Vicente', middle: 'Quiambao', last: 'Esguerra', sex: 'M', section: 'STEM 12-A', grades: 'slipping', attendance: 'dipping', email: 'vicente.esguerra@example.com' },
  { lrn: '100000000042', first: 'Wilma', middle: 'Reyes', last: 'Fajardo', sex: 'F', section: 'STEM 12-A', grades: 'struggling', attendance: 'spotty', email: 'wilma.fajardo@example.com', flags: { is4ps: true } },
];

// --- The school calendar ----------------------------------------------------
// Attendance endpoints resolve the grading period FROM THE DATE, so every
// date below has to fall inside its term's range or the record lands in
// the wrong period. Ten school days per term: enough for a rate to be
// meaningful, few enough to seed quickly.
// Also keyed by sequence number, for the same reason.
const PERIOD_DATES = {
  1: [
    '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-08',
    '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-15',
  ],
  2: [
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
  ],
};

// --- Work left deliberately unfinished --------------------------------------
// Each page in the grade workflow reads a different status, so a dataset
// where every grade is already finalized leaves Verify Grades and Finalize
// Grades empty — which is exactly what happened before this existed.
//
// These lanes apply to the CURRENT term, not a future one. Verify Grades
// auto-selects whichever grading period contains today (see
// VerifyGradesPage.jsx), so work parked in a later term would be invisible
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

module.exports = {
  TEACHER_OVERRIDES,
  PERIODS,
  GRADED_PERIODS,
  DEMO_PASSWORD,
  STAFF,
  SECTIONS,
  SUBJECTS,
  GRADE_PROFILES,
  ATTENDANCE_PROFILES,
  STUDENTS,
  PERIOD_DATES,
  CURRENT_PERIOD_LANES,
  INTERVENTIONS,
};
