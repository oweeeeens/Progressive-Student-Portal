// Populates realistic grades and daily attendance for the students created
// by seedSampleData.js, going through the REAL grade approval chain (submit
// -> principal verify -> adviser finalize) and the real attendance endpoint
// — not raw INSERTs — so risk_assessments gets calculated exactly the way
// it would from live use, and the student/adviser/Academic Progress
// Tracking views all have something real to show.
//
// Deliberately kept separate from seedSampleData.js: that script is
// intentionally structural-only (school year, sections, students, accounts)
// and leaves grades/attendance for live entry through the UI — this script
// is an optional, repeatable way to pre-populate a demo-ready dataset on
// top of it. Safe to re-run: grade submission upserts, and daily attendance
// upserts on (student, date), so running this twice just overwrites the
// same rows with the same values.
//
// Usage: npm run seed:demo-data (after npm run seed:sample)
require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
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
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(parsed)}`);
  return parsed;
}

// section id -> grading period id -> { studentId: gradeValue }
const GRADE_PLAN = {
  // STEM A (offering 1), General Math
  1: {
    1: { 1: 92, 2: 82 }, // Q1: Ana=92, Ben=82
    2: { 1: 95, 2: 79 }, // Q2: Ana=95, Ben=79
  },
  // STEM B (offering 2), General Math
  2: {
    1: { 3: 74, 4: 85 }, // Q1: Carlo=74, Dina=85
    2: { 3: 62, 4: 87 }, // Q2: Carlo=62 (declining fast), Dina=87
  },
};
const OFFERING_BY_SECTION = { 1: 1, 2: 2 }; // ABM A (section 3) has no offering — grades skipped

// Matches seedSampleData.js's 3-quarter layout (Q1 Jun1-Sep15, Q2 Sep16-Dec31,
// Q3 Jan1-Mar31) — these dates must each fall inside their matching period's
// range or they'd get attributed to the wrong grading period (see
// test/integration/helpers/fixtures.js's isolation note for why that matters).
const PERIOD_DATES = {
  1: ['2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'],
  2: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'],
};

// section id -> grading period id -> { studentId: ['present'|'absent'|'late', ...] }
const ATTENDANCE_PLAN = {
  1: {
    1: { 1: ['present', 'present', 'present', 'present'], 2: ['present', 'present', 'present', 'absent'] },
    2: { 1: ['present', 'present', 'present', 'present'], 2: ['present', 'absent', 'present', 'present'] },
  },
  2: {
    1: { 3: ['present', 'present', 'absent', 'absent'], 4: ['present', 'present', 'present', 'present'] },
    2: { 3: ['absent', 'absent', 'present', 'absent'], 4: ['present', 'present', 'absent', 'present'] },
  },
  3: {
    1: { 5: ['present', 'present', 'present', 'present'], 6: ['present', 'absent', 'present', 'present'] },
    2: { 5: ['present', 'present', 'present', 'absent'], 6: ['present', 'present', 'absent', 'present'] },
  },
};

const SECTION_ADVISER_TOKEN_KEY = { 1: 'adviser1', 2: 'adviser2', 3: 'adviser2' };

async function submitVerifyFinalize(teacherToken, principalToken, adviserToken, offeringId, sectionId, periodId, grades) {
  const entries = Object.entries(grades).map(([studentId, gradeValue]) => ({ studentId: Number(studentId), gradeValue }));
  const submitted = await api('POST', '/api/grades', teacherToken, { classOfferingId: offeringId, gradingPeriodId: periodId, entries });
  const gradeIds = submitted.grades.map((g) => g.id);
  await api('POST', '/api/grades/verify', principalToken, { gradeIds });
  await api('POST', '/api/grades/finalize', adviserToken, { sectionId, gradingPeriodId: periodId });
}

async function submitAttendance(adviserToken, sectionId, periodId, perStudentPattern) {
  const dates = PERIOD_DATES[periodId];
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const entries = Object.entries(perStudentPattern).map(([studentId, pattern]) => ({
      studentId: Number(studentId),
      status: pattern[dayIndex],
    }));
    await api('POST', '/api/attendance/daily', adviserToken, {
      sectionId,
      attendanceDate: dates[dayIndex],
      entries,
    });
  }
}

// Subject-level attendance, logged by the SUBJECT TEACHER against their own
// class offering — the second, supplementary attendance record (CLAUDE.md),
// and the one the student's "Attendance by Subject" table reads. Deliberately
// NOT a copy of the daily plan above: a student can sit through homeroom and
// still miss a subject period, and the two records differing slightly is the
// whole reason the school keeps both.
const SUBJECT_ATTENDANCE_PLAN = {
  1: {
    1: { 1: ['present', 'present', 'present', 'late'], 2: ['present', 'present', 'absent', 'absent'] },
    2: { 1: ['present', 'present', 'present', 'present'], 2: ['present', 'absent', 'present', 'absent'] },
  },
  2: {
    1: { 3: ['present', 'absent', 'absent', 'absent'], 4: ['present', 'present', 'late', 'present'] },
    2: { 3: ['absent', 'absent', 'absent', 'late'], 4: ['present', 'present', 'absent', 'present'] },
  },
  // Section 3 (ABM A) is absent here for the same reason it is absent from
  // GRADE_PLAN: it has no class offering, so there is no subject period to
  // take attendance in (see OFFERING_BY_SECTION).
};

async function submitSubjectAttendance(teacherToken, sectionId, periodId, perStudentPattern) {
  const offeringId = OFFERING_BY_SECTION[sectionId];
  const dates = PERIOD_DATES[periodId];
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const entries = Object.entries(perStudentPattern).map(([studentId, pattern]) => ({
      studentId: Number(studentId),
      status: pattern[dayIndex],
    }));
    await api('POST', '/api/attendance/subject', teacherToken, {
      classOfferingId: offeringId,
      attendanceDate: dates[dayIndex],
      entries,
    });
  }
}

async function main() {
  console.log('Logging in as seed test accounts...');
  const teacherToken = await login('subject_teacher@studentportal.local', 'Password123!');
  const principalToken = await login('principal@studentportal.local', 'Password123!');
  const adviser1Token = await login('adviser@studentportal.local', 'Password123!'); // STEM A
  const adviser2Token = await login('adviser2@studentportal.local', 'Password123!'); // STEM B, ABM A
  const adviserTokens = { adviser1: adviser1Token, adviser2: adviser2Token };

  for (const [sectionId, byPeriod] of Object.entries(GRADE_PLAN)) {
    const offeringId = OFFERING_BY_SECTION[sectionId];
    const adviserToken = adviserTokens[SECTION_ADVISER_TOKEN_KEY[sectionId]];
    for (const [periodId, grades] of Object.entries(byPeriod)) {
      console.log(`Grades: section ${sectionId}, period ${periodId}...`);
      await submitVerifyFinalize(teacherToken, principalToken, adviserToken, offeringId, Number(sectionId), Number(periodId), grades);
    }
  }

  for (const [sectionId, byPeriod] of Object.entries(ATTENDANCE_PLAN)) {
    const adviserToken = adviserTokens[SECTION_ADVISER_TOKEN_KEY[sectionId]];
    for (const [periodId, pattern] of Object.entries(byPeriod)) {
      console.log(`Attendance: section ${sectionId}, period ${periodId}...`);
      await submitAttendance(adviserToken, Number(sectionId), Number(periodId), pattern);
    }
  }

  for (const [sectionId, byPeriod] of Object.entries(SUBJECT_ATTENDANCE_PLAN)) {
    for (const [periodId, pattern] of Object.entries(byPeriod)) {
      console.log(`Subject attendance: section ${sectionId}, period ${periodId}...`);
      await submitSubjectAttendance(teacherToken, Number(sectionId), Number(periodId), pattern);
    }
  }

  console.log('\nDone. Each finalize/attendance submission above triggered a real risk recalculation.');
  console.log('Log in as student@studentportal.local (Carlo Santos) or ana.reyes.student@example.com (Ana Reyes) to see it from the student side.');
}

main().catch((err) => {
  console.error('Failed to seed demo academic data:', err.message);
  process.exitCode = 1;
});
