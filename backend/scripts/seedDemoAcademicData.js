// Populates grades, attendance, interventions and announcements for the
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
  SUBJECT_ATTENDANCE_CODES,
  CURRENT_PERIOD_LANES,
  INTERVENTIONS,
  ANNOUNCEMENTS,
} = require('./demoDataset');

const BASE_URL = (process.env.SEED_BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

// The accounts this script signs in as. Deliberately exactly nine, because
// the login endpoint allows ten attempts per IP per 15 minutes
// (routes/authRoutes.js) — a tenth would make the script trip its own rate
// limit.
const PRINCIPAL = 'principal@studentportal.local';
const REGISTRAR = 'registrar@studentportal.local';
const GUIDANCE = 'guidance@studentportal.local';
const ADVISER_BY_SECTION = {
  'STEM A': 'adviser@studentportal.local',
  'STEM B': 'adviser2@studentportal.local',
  'ABM A': 'adviser3@studentportal.local',
};

// The subject teachers, taken from the dataset rather than listed again here.
function teacherEmails() {
  return [...new Set(SUBJECTS.map((s) => s.teacher))];
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
// report card does not read as the same number eight times. Deterministic
// (derived from the subject code) so re-running produces identical data.
// Clamped to 60-100, the range the grade endpoint accepts.
function gradeFor(profileName, periodKey, subjectCode) {
  const base = GRADE_PROFILES[profileName][periodKey.toLowerCase()];
  const offset = ((subjectCode.charCodeAt(0) + subjectCode.charCodeAt(1)) % 5) - 2;
  return Math.max(60, Math.min(100, base + offset));
}

// Turns "attended 8 of the 10 school days" into an actual list of statuses.
// One attended day is marked `late` rather than `present`: late still counts
// as attending, so the attendance RATE is unchanged, but it gives the
// attendance views more than two statuses to render.
function attendanceFor(profileName, periodKey, dateCount) {
  const attended = ATTENDANCE_PROFILES[profileName][periodKey.toLowerCase()];
  return Array.from({ length: dateCount }, (_, index) => {
    if (index >= attended) return 'absent';
    return index === 1 && attended < dateCount ? 'late' : 'present';
  });
}

// Only active, enrolled students are graded and marked. The dataset's
// transferred and dropped students still appear on the roster — which is
// exactly the case the Students filters exist to show — but giving them
// marks for a quarter they were not enrolled in would be wrong.
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
  const entries = rosterFor(sectionName).map((student) => ({
    studentId: studentIdByLrn.get(student.lrn),
    gradeValue: gradeFor(student.grades, periodKey, subjectCode),
  }));
  const submitted = await api('POST', '/api/grades', tokens[teacherEmail], {
    classOfferingId: offeringId,
    gradingPeriodId: periodId,
    entries,
  });
  return submitted.grades.map((g) => g.id);
}

// --- Main -------------------------------------------------------------------

async function main() {
  console.log(`Seeding demo academic data against ${BASE_URL}`);

  const tokens = {};
  for (const email of [PRINCIPAL, REGISTRAR, GUIDANCE, ...Object.values(ADVISER_BY_SECTION), ...teacherEmails()]) {
    tokens[email] = await login(email, DEMO_PASSWORD);
  }
  const principal = tokens[PRINCIPAL];
  const adviserToken = (sectionName) => tokens[ADVISER_BY_SECTION[sectionName]];

  const { periodIdByName, sectionIdByName, offeringByKey, studentIdByLrn } = await loadReferenceData(tokens);
  const sectionNames = Object.keys(ADVISER_BY_SECTION);
  const offeringsFor = (sectionName) =>
    SUBJECTS.filter((subject) => offeringByKey.has(`${sectionName}|${subject.code}`));

  // Which quarter the unfinished work belongs in: the one the grade pages
  // open on, which is the one containing today. Asked rather than assumed,
  // because parking it in the wrong quarter is what made Verify and Finalize
  // look empty.
  const currentPeriod = await api('GET', '/api/grading-periods/current', tokens[REGISTRAR]);
  const lanePeriod = ['Q1', 'Q2'].includes(currentPeriod.gradingPeriod?.name)
    ? currentPeriod.gradingPeriod.name
    : 'Q2';
  console.log(`  in-progress work goes in ${lanePeriod} (the quarter containing today)`);

  // --- Q1 and Q2: the full approval chain, all the way to finalized ---------
  // These are the periods the risk engine reads, so they have to end up as
  // the official record — except for the handful of classes each lane holds
  // back on purpose so the approval pages have something in their queues.
  for (const periodKey of ['Q1', 'Q2']) {
    const periodId = periodIdByName.get(periodKey);
    for (const sectionName of sectionNames) {
      const lane = (periodKey === lanePeriod && CURRENT_PERIOD_LANES[sectionName]) || {};
      const heldBack = [...(lane.submitted || []), ...(lane.rejected || []), ...(lane.verified || [])];
      const ungraded = lane.ungraded || [];

      for (const subject of offeringsFor(sectionName)) {
        if (heldBack.includes(subject.code) || ungraded.includes(subject.code)) continue;
        const gradeIds = await submitGrades({
          tokens,
          offeringId: offeringByKey.get(`${sectionName}|${subject.code}`),
          periodId,
          sectionName,
          subjectCode: subject.code,
          periodKey,
          studentIdByLrn,
          teacherEmail: subject.teacher,
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
          teacherEmail: subject.teacher,
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
  for (const periodKey of ['Q1', 'Q2']) {
    const dates = PERIOD_DATES[periodKey];
    for (const sectionName of sectionNames) {
      const roster = rosterFor(sectionName).map((student) => ({
        studentId: studentIdByLrn.get(student.lrn),
        statuses: attendanceFor(student.attendance, periodKey, dates.length),
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

  // --- Subject attendance (supplementary; never feeds the risk score) ------
  // Only a few subjects keep it, and over fewer days, so it visibly differs
  // from the homeroom record — which is the whole reason both tables exist.
  for (const periodKey of ['Q1', 'Q2']) {
    const dates = PERIOD_DATES[periodKey].slice(0, 6);
    for (const sectionName of sectionNames) {
      for (const code of SUBJECT_ATTENDANCE_CODES) {
        const offeringId = offeringByKey.get(`${sectionName}|${code}`);
        if (!offeringId) continue;
        const subject = SUBJECTS.find((s) => s.code === code);
        const roster = rosterFor(sectionName).map((student) => ({
          studentId: studentIdByLrn.get(student.lrn),
          statuses: attendanceFor(student.attendance, periodKey, dates.length),
        }));
        for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
          await api('POST', '/api/attendance/subject', tokens[subject.teacher], {
            classOfferingId: offeringId,
            attendanceDate: dates[dayIndex],
            entries: roster.map((r) => ({ studentId: r.studentId, status: r.statuses[dayIndex] })),
          });
        }
        console.log(`  subject attendance ${periodKey} ${sectionName} ${code}: ${dates.length} meetings`);
      }
    }
  }

  // --- Interventions --------------------------------------------------------
  // The API requires a risk assessment for TODAY's grading period before an
  // intervention can be logged, and that assessment exists only because the
  // quarter above was finalized first. Order matters here.
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

  // --- Announcements --------------------------------------------------------
  // Posted by the registrar, one of the four roles allowed to post. One
  // carries a PDF, which also proves the deployment's upload volume is
  // mounted and writable.
  for (const announcement of ANNOUNCEMENTS) {
    const form = new FormData();
    form.append('title', announcement.title);
    form.append('body', announcement.body);
    if (announcement.attachment) {
      const pdf = buildPlaceholderPdf(announcement.title);
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), announcement.attachment);
    }
    const res = await fetch(`${BASE_URL}/api/announcements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens[REGISTRAR]}` },
      body: form,
    });
    if (!res.ok) throw new Error(`announcement "${announcement.title}" failed: ${res.status} ${await res.text()}`);
    console.log(`  announcement: ${announcement.title}`);
  }

  console.log('\nDone. Every finalization and attendance submission above ran a real risk recalculation.');
  console.log(`Sign in as student@studentportal.local / ${DEMO_PASSWORD} (Carlo Santos, High Risk) for the student view.`);
}

// A minimal valid one-page PDF, assembled here rather than pulled from a
// library, so the seed can attach a real file without the repo carrying a
// binary fixture. Byte offsets are collected as the objects are written,
// which is what the xref table at the end needs.
function buildPlaceholderPdf(title) {
  const safeTitle = title.replace(/[()\\]/g, '');
  const content = `BT /F1 16 Tf 72 720 Td (${safeTitle}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

main().catch((err) => {
  console.error(`\nFailed to seed demo academic data: ${err.message}`);
  process.exitCode = 1;
});
