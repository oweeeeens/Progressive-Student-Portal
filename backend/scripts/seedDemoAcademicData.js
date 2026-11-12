// Populates grades, attendance and interventions for the
// school created by seedSampleData.js, going through the REAL API — submit →
// principal verify → adviser finalize, and the real attendance endpoints —
// not raw INSERTs. That matters: risk_assessments is then produced by the
// engine exactly as live use would produce it, which is the claim the thesis
// actually makes.
//
// Everything is looked up by LRN, section name and subject code (never by
// hardcoded id), so this script and demoDataset.js cannot drift apart.
//
// Usage: npm run seed:demo-data (after npm run seed:sample)
//
// Against a DEPLOYED instance, set SEED_BASE_URL to its public URL and run
// this from your own machine:
//   SEED_BASE_URL=https://your-app.up.railway.app npm run seed:demo-data
// It drives the same public endpoints a browser would, so it needs no
// database credentials and no admin account — only the staff accounts
// seed:sample creates.
require('dotenv').config();

const {
  DEMO_PASSWORD,
  SUBJECTS,
  GRADE_PROFILES,
  ATTENDANCE_PROFILES,
  STUDENTS,
  PERIOD_DATES,
  CURRENT_PERIOD_LANES,
  INTERVENTIONS,
  SECTIONS,
  PERIODS,
  GRADED_PERIODS,
  TEACHER_OVERRIDES,
} = require('./demoDataset');
const { offeringCoversPeriod } = require('../config/academicTerms');
const { demoItemsFor, scoresForGrade } = require('./lib/demoClassRecord');

// A term is matched to a grading period by its position in the year, not by
// its name, so the generator has to know which number each name carries.
function sequenceOfPeriod(name) {
  return PERIODS.find((p) => p.name === name)?.sequenceNumber ?? null;
}

const BASE_URL = (process.env.SEED_BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

// The accounts this script signs in as. The list is deduplicated before use
// (see main) because the login endpoint allows ten attempts per IP per 15
// minutes — and one teacher can advise two sections.
const PRINCIPAL = 'principal@studentportal.local';
const REGISTRAR = 'registrar@studentportal.local';
const GUIDANCE = 'guidance@studentportal.local';
// Derived from the dataset rather than listed again here, so adding a
// section cannot leave it without an adviser token and silently ungraded —
// which is exactly what happened the first time a Grade 12 section was added.
const ADVISER_BY_SECTION = Object.fromEntries(SECTIONS.map((sec) => [sec.name, sec.adviser]));

// Everyone who OWNS a class offering — the subjects' default teachers, plus
// anyone a TEACHER_OVERRIDES entry reassigned a class to.
//
// The overrides were missing here, and that was a real bug rather than an
// omission. This list is what loadReferenceData signs in as to build
// `offeringByKey` from each teacher's own /class-offerings/mine. An offering
// reassigned to somebody outside the list therefore never appeared in that
// map, `offeringsFor()` filtered it out, and the class silently received no
// grades for the entire seed. ABM A's Personal
// Development had been in exactly that state since the first override was
// added.
//
// Safe to widen: the caller de-duplicates before logging in, and every
// override target is already an adviser in ADVISER_BY_SECTION — so the
// number of distinct logins does not change, which matters because the login
// endpoint allows ten attempts per IP per 15 minutes.
function teacherEmails() {
  return [...new Set([...SUBJECTS.map((s) => s.teacher), ...Object.values(TEACHER_OVERRIDES)])];
}

// Who actually teaches this subject to this section — the override if there
// is one, otherwise the subject's default teacher.
//
// This has to agree exactly with the same lookup in seedSampleData.js, which
// is what decided class_offerings.teacher_id when the offering was created.
// If the two disagree, this script submits as an account that does not own
// the class and the API refuses the write, which is the correct behaviour
// and a confusing way to discover a seed bug.
function teacherFor(sectionName, subjectCode, fallbackEmail) {
  return TEACHER_OVERRIDES[`${sectionName}|${subjectCode}`] || fallbackEmail;
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 429) {
    throw new Error(
      'the login rate limit is exhausted (10 attempts per IP per 15 minutes). ' +
        'Wait 15 minutes, or restart the backend locally — that counter is held in memory.'
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login failed for ${email}: ${JSON.stringify(body)}`);
  return body.token;
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// --- Grade and attendance shapes --------------------------------------------

// Each subject is nudged a few points off the student's profile average, so a
// student's grade view does not read as the same number eight times. Deterministic
// (derived from the subject code) so re-running produces identical data.
// Clamped to 60-100, the range the grade endpoint accepts.
function gradeFor(profileName, periodSequence, subjectCode) {
  const base = GRADE_PROFILES[profileName][periodSequence];
  const offset = ((subjectCode.charCodeAt(0) + subjectCode.charCodeAt(1)) % 5) - 2;
  return Math.max(60, Math.min(100, base + offset));
}

// Turns "attended 8 of the 10 school days" into an actual list of statuses.
// One attended day is marked `late` rather than `present`: late still counts
// as attending, so the attendance RATE is unchanged, but it gives the
// attendance views more than two statuses to render.
function attendanceFor(profileName, periodSequence, dateCount) {
  const attended = ATTENDANCE_PROFILES[profileName][periodSequence];
  return Array.from({ length: dateCount }, (_, index) => {
    if (index >= attended) return 'absent';
    return index === 1 && attended < dateCount ? 'late' : 'present';
  });
}

// Only active, enrolled students are graded and marked. The dataset's
// transferred and dropped students still appear on the roster — which is
// exactly the case the Students filters exist to show — but giving them
// marks for a term they were not enrolled in would be wrong.
function rosterFor(sectionName) {
  return STUDENTS.filter(
    (s) => s.section === sectionName && (s.enrollmentStatus || 'enrolled') === 'enrolled'
  );
}

// --- Reference data ---------------------------------------------------------

// Resolves every id this script needs from names, using only endpoints the
// seeded staff accounts can actually reach:
//   - grading periods and sections: any authenticated user
//   - students: the registrar, who sees the whole school
//   - class offerings: each teacher's OWN list, unioned. The school-wide
//     listing is admin-only, and a deployment's admin password lives in
//     Railway's variables rather than here.
async function loadReferenceData(tokens) {
  const registrar = tokens[REGISTRAR];

  const [periodsResponse, sectionsResponse] = await Promise.all([
    api('GET', '/api/grading-periods', registrar),
    api('GET', '/api/sections', registrar),
  ]);

  const periodIdByName = new Map(periodsResponse.gradingPeriods.map((p) => [p.name, p.id]));
  const sectionIdByName = new Map(sectionsResponse.sections.map((s) => [s.name, s.id]));

  // Offerings keyed "SECTION|SUBJECTCODE". Each teacher's own list carries
  // the section and subject NAMES, which is what keeps this id-free.
  const subjectCodeByName = new Map(SUBJECTS.map((s) => [s.name, s.code]));
  const offeringByKey = new Map();
  for (const email of teacherEmails()) {
    const { classOfferings } = await api('GET', '/api/class-offerings/mine', tokens[email]);
    for (const offering of classOfferings) {
      const code = subjectCodeByName.get(offering.subject_name);
      if (code) offeringByKey.set(`${offering.section_name}|${code}`, offering.id);
    }
  }

  // Students are matched by LRN, the one identifier the dataset and the
  // database are guaranteed to agree on.
  const students = [];
  let page = 1;
  for (;;) {
    const response = await api('GET', `/api/students?page=${page}&pageSize=100`, registrar);
    students.push(...response.students);
    if (students.length >= response.total || response.students.length === 0) break;
    page += 1;
  }
  const studentIdByLrn = new Map(students.map((s) => [s.lrn, s.id]));

  return { periodIdByName, sectionIdByName, offeringByKey, studentIdByLrn };
}

// --- Grades -----------------------------------------------------------------

// Submits one class's grades for one period as the teacher who owns it, and
// returns the new grade ids so the caller can verify or reject them.
async function submitGrades({
  tokens,
  offeringId,
  periodId,
  sectionName,
  subjectCode,
  periodKey,
  studentIdByLrn,
  teacherEmail,
}) {
  // Grades are computed from scores now (DepEd Order No. 015, s. 2026), so
  // each learner's demo grade becomes a class record that computes to it:
  // a typical set of quizzes, tasks and exams for the term, and scores per
  // learner produced by scripts/lib/demoClassRecord.js — then the COMPUTED
  // grades are submitted, exactly as a teacher's would be.
  const token = tokens[teacherEmail];
  const entries = rosterFor(sectionName).map((student) => ({
    studentId: studentIdByLrn.get(student.lrn),
    gradeValue: gradeFor(student.grades, sequenceOfPeriod(periodKey), subjectCode),
  }));
  const scope = { classOfferingId: offeringId, gradingPeriodId: periodId };
  const record = await api('GET', `/api/class-record?classOfferingId=${offeringId}&gradingPeriodId=${periodId}`, token);
  const items = [...record.items];
  if (items.length === 0) {
    for (const spec of demoItemsFor(record.policy.weightGroup)) {
      const created = await api('POST', '/api/class-record/items', token, { ...scope, ...spec });
      items.push(created.item);
    }
  }
  const scores = [];
  for (const entry of entries) {
    const generated = scoresForGrade({ items, termGrade: entry.gradeValue, weightGroup: record.policy.weightGroup, seed: entry.studentId * 31 + periodId });
    if (!generated) throw new Error(`No scores compute to ${entry.gradeValue} for student ${entry.studentId}`);
    for (const [itemId, rawScore] of generated) scores.push({ itemId, studentId: entry.studentId, rawScore });
  }
  await api('PUT', '/api/class-record/scores', token, { ...scope, scores });
  const submitted = await api('POST', '/api/class-record/submit', token, { ...scope, studentIds: entries.map((e) => e.studentId) });
  return submitted.grades.map((g) => g.id);
}

// --- Main -------------------------------------------------------------------

async function main() {
  console.log(`Seeding demo academic data against ${BASE_URL}`);

  // Deduplicated, and that matters: the login endpoint allows ten attempts
  // per IP per 15 minutes (routes/authRoutes.js), and one teacher advising
  // two sections appears twice in ADVISER_BY_SECTION. Adding the Grade 12
  // section — advised by the same person as STEM B — took the list to
  // exactly ten logins for nine accounts, with the second one spent
  // re-authenticating as somebody the script had already signed in as. The
  // Set makes the count the number of distinct people, which is the number
  // that should ever have governed it.
  const tokens = {};
  const accounts = [...new Set([
    PRINCIPAL,
    REGISTRAR,
    GUIDANCE,
    ...Object.values(ADVISER_BY_SECTION),
    ...teacherEmails(),
  ])];
  for (const email of accounts) {
    tokens[email] = await login(email, DEMO_PASSWORD);
  }
  console.log(`  signed in as ${accounts.length} accounts`);
  const principal = tokens[PRINCIPAL];
  const adviserToken = (sectionName) => tokens[ADVISER_BY_SECTION[sectionName]];

  const { periodIdByName, sectionIdByName, offeringByKey, studentIdByLrn } = await loadReferenceData(tokens);
  const sectionNames = Object.keys(ADVISER_BY_SECTION);
  const offeringsFor = (sectionName) =>
    SUBJECTS.filter((subject) => offeringByKey.has(`${sectionName}|${subject.code}`));

  // Which term the unfinished work belongs in: the one the grade pages
  // open on, which is the one containing today. Asked rather than assumed,
  // because parking it in the wrong term is what made Verify and Finalize
  // look empty.
  const currentPeriod = await api('GET', '/api/grading-periods/current', tokens[REGISTRAR]);
  const lanePeriod = GRADED_PERIODS.includes(currentPeriod.gradingPeriod?.name)
    ? currentPeriod.gradingPeriod.name
    : GRADED_PERIODS[GRADED_PERIODS.length - 1];
  console.log(`  in-progress work goes in ${lanePeriod} (the term containing today)`);

  // --- Q1 and Q2: the full approval chain, all the way to finalized ---------
  // These are the periods the risk engine reads, so they have to end up as
  // the official record — except for the handful of classes each lane holds
  // back on purpose so the approval pages have something in their queues.
  for (const periodKey of GRADED_PERIODS) {
    const periodId = periodIdByName.get(periodKey);
    for (const sectionName of sectionNames) {
      const lane = (periodKey === lanePeriod && CURRENT_PERIOD_LANES[sectionName]) || {};
      const heldBack = [...(lane.submitted || []), ...(lane.rejected || []), ...(lane.verified || [])];
      const ungraded = lane.ungraded || [];

      for (const subject of offeringsFor(sectionName)) {
        if (heldBack.includes(subject.code) || ungraded.includes(subject.code)) continue;
        // A class that runs for a single term does not get marks in any
        // other one. A Grade 12 subject set to Term 3 is therefore skipped
        // here entirely and shows up with no marks in its own tab — the
        // honest state for a term the school has not reached yet.
        if (!offeringCoversPeriod({
          term: subject.term,
          subjectCategory: subject.category,
          periodSequenceNumber: sequenceOfPeriod(periodKey),
        })) {
          continue;
        }
        const gradeIds = await submitGrades({
          tokens,
          offeringId: offeringByKey.get(`${sectionName}|${subject.code}`),
          periodId,
          sectionName,
          subjectCode: subject.code,
          periodKey,
          studentIdByLrn,
          teacherEmail: teacherFor(sectionName, subject.code, subject.teacher),
        });
        // gradingPeriodId is required: the bulk verify is bounded to the
        // period the principal's queue was filtered to, so one call can
        // never reach grades outside it.
        await api('POST', '/api/grades/verify', principal, { gradeIds, gradingPeriodId: periodId });
        console.log(`  grades ${periodKey} ${sectionName} ${subject.code}: ${gradeIds.length} submitted and verified`);
      }

      // Finalizing acts on a whole section and period at once, and is the
      // point where the risk engine runs. It only takes what is currently
      // principal-verified, which is why the held-back classes are submitted
      // AFTER this call rather than before it.
      const result = await api('POST', '/api/grades/finalize', adviserToken(sectionName), {
        sectionId: sectionIdByName.get(sectionName),
        gradingPeriodId: periodId,
      });
      console.log(`  finalized ${periodKey} ${sectionName}: risk recalculated for ${result.finalizedCount} students`);

      // The held-back classes, each left at the status whose page needs it.
      for (const code of heldBack) {
        const subject = SUBJECTS.find((s) => s.code === code);
        const gradeIds = await submitGrades({
          tokens,
          offeringId: offeringByKey.get(`${sectionName}|${code}`),
          periodId,
          sectionName,
          subjectCode: code,
          periodKey,
          studentIdByLrn,
          teacherEmail: teacherFor(sectionName, code, subject.teacher),
        });

        if ((lane.rejected || []).includes(code)) {
          await api('POST', '/api/grades/reject', principal, {
            gradeIds,
            gradingPeriodId: periodId,
            note: 'Two students are missing a performance task score. Please complete and resubmit.',
          });
          console.log(`  ${periodKey} ${sectionName} ${code}: rejected — back with the subject teacher`);
        } else if ((lane.verified || []).includes(code)) {
          await api('POST', '/api/grades/verify', principal, { gradeIds, gradingPeriodId: periodId });
          console.log(`  ${periodKey} ${sectionName} ${code}: verified — waiting for the adviser to finalize`);
        } else {
          console.log(`  ${periodKey} ${sectionName} ${code}: submitted — waiting for the principal`);
        }
      }

      for (const code of ungraded) {
        console.log(`  ${periodKey} ${sectionName} ${code}: left ungraded — the teacher enters this one live`);
      }
    }
  }

  // --- Daily attendance (the official SF2 record, and a risk input) ---------
  for (const periodKey of GRADED_PERIODS) {
    const dates = PERIOD_DATES[sequenceOfPeriod(periodKey)];
    for (const sectionName of sectionNames) {
      const roster = rosterFor(sectionName).map((student) => ({
        studentId: studentIdByLrn.get(student.lrn),
        statuses: attendanceFor(student.attendance, sequenceOfPeriod(periodKey), dates.length),
      }));
      for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
        await api('POST', '/api/attendance/daily', adviserToken(sectionName), {
          sectionId: sectionIdByName.get(sectionName),
          attendanceDate: dates[dayIndex],
          entries: roster.map((r) => ({ studentId: r.studentId, status: r.statuses[dayIndex] })),
        });
      }
      console.log(`  daily attendance ${periodKey} ${sectionName}: ${dates.length} school days`);
    }
  }

  // --- Interventions --------------------------------------------------------
  // The API requires a risk assessment for TODAY's grading period before an
  // intervention can be logged, and that assessment exists only because the
  // term above was finalized first. Order matters here.
  const guidance = tokens[GUIDANCE];
  for (const intervention of INTERVENTIONS) {
    const studentId = studentIdByLrn.get(intervention.lrn);
    if (!studentId) continue;
    const created = await api('POST', `/api/students/${studentId}/interventions`, guidance, {
      interventionType: intervention.type,
      notes: intervention.notes,
    });
    if (intervention.status !== 'open') {
      await api('PATCH', `/api/interventions/${created.intervention.id}/status`, guidance, {
        status: intervention.status,
      });
    }
    console.log(`  intervention ${intervention.type} (${intervention.status}) for LRN ${intervention.lrn}`);
  }

  console.log('\nDone. Every finalization and attendance submission above ran a real risk recalculation.');
  console.log(`Sign in as student@studentportal.local / ${DEMO_PASSWORD} (Carlo Santos, High Risk) for the student view.`);
}

main().catch((err) => {
  console.error(`\nFailed to seed demo academic data: ${err.message}`);
  process.exitCode = 1;
});
