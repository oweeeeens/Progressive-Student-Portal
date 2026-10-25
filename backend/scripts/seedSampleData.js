// Dev/demo sample data: the structure of a small senior high school —
// accounts, school year, grading periods, sections, subjects, class
// offerings and student records. Not meant for production use.
//
// Safe to re-run: it truncates school_years first, which cascades through
// every table that transitively references it (sections, class_offerings,
// students, grading_periods, both attendance tables, risk_assessments,
// interventions) — so each run starts from a clean slate for academic data.
// User accounts are upserted rather than truncated, so logins stay stable.
//
// Deliberately structural only. Grades, attendance, interventions and
// announcements are created by seedDemoAcademicData.js THROUGH THE REAL API,
// so the approval chain runs and risk scores are calculated rather than
// invented. The roster both scripts work from lives in demoDataset.js.
require('dotenv').config();

const { pool } = require('../config/db');
const userModel = require('../models/userModel');
const {
  DEMO_PASSWORD,
  STAFF,
  SECTIONS,
  SUBJECTS,
  STUDENTS,
} = require('./demoDataset');

// Upsert by email so re-seeding never invalidates a login someone is already
// using in a demo.
async function upsertUser(email, fullName, role) {
  const existing = await userModel.findByEmail(email);
  if (existing) return existing.id;
  const user = await userModel.createUser({ email, password: DEMO_PASSWORD, fullName, role });
  return user.id;
}

async function seed() {
  await pool.query('TRUNCATE school_years RESTART IDENTITY CASCADE');
  // Announcements hang off users, not school_years, so the cascade above
  // misses them — and seedDemoAcademicData.js POSTs them rather than
  // upserting, so without this a second run would leave two copies of every
  // announcement. Any attachment already written to the uploads directory is
  // left behind as an unreferenced file, which is harmless.
  await pool.query('TRUNCATE announcements RESTART IDENTITY');

  // --- Staff accounts, one per role ----------------------------------------
  const userIdByEmail = new Map();
  for (const person of STAFF) {
    const id = await upsertUser(person.email, person.fullName, person.role);
    userIdByEmail.set(person.email, id);

    // The two accounts that exist to show User Management's own states. Set
    // explicitly on every run, because an earlier run may have left them in
    // the opposite state.
    await pool.query('UPDATE users SET is_active = $2, must_change_password = $3 WHERE id = $1', [
      id,
      person.state !== 'inactive',
      person.state === 'pending-first-login',
    ]);
  }

  // --- School year and grading periods -------------------------------------
  // Covers "now" in this demo environment; the PH school year runs June-March.
  const schoolYear = await pool.query(
    `INSERT INTO school_years (label, start_date, end_date, is_current)
     VALUES ('2026-2027', '2026-06-01', '2027-03-31', TRUE)
     RETURNING id`
  );
  const schoolYearId = schoolYear.rows[0].id;

  // The attendance endpoints resolve a grading period from the date, so these
  // ranges are what put a record in the right quarter.
  const periods = [
    ['Q1', 1, '2026-06-01', '2026-09-15'],
    ['Q2', 2, '2026-09-16', '2026-12-31'],
    ['Q3', 3, '2027-01-01', '2027-03-31'],
  ];
  for (const [name, sequence, start, end] of periods) {
    await pool.query(
      `INSERT INTO grading_periods (school_year_id, name, sequence_number, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [schoolYearId, name, sequence, start, end]
    );
  }

  // --- Sections -------------------------------------------------------------
  const sectionIdByName = new Map();
  for (const section of SECTIONS) {
    const result = await pool.query(
      `INSERT INTO sections (school_year_id, grade_level, strand, name, adviser_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [schoolYearId, section.gradeLevel, section.strand, section.name, userIdByEmail.get(section.adviser)]
    );
    sectionIdByName.set(section.name, result.rows[0].id);
  }

  // --- Subjects -------------------------------------------------------------
  // subjects is NOT cascaded by the truncate above (it hangs off nothing), so
  // this upserts on the unique code and reads the id back rather than
  // assuming a fresh sequence.
  const subjectIdByCode = new Map();
  for (const subject of SUBJECTS) {
    const result = await pool.query(
      `INSERT INTO subjects (name, code, grade_level)
       VALUES ($1, $2, 11)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [subject.name, subject.code]
    );
    subjectIdByCode.set(subject.code, result.rows[0].id);
  }

  // --- Class offerings ------------------------------------------------------
  // A subject is offered to a section only if the section's strand takes it,
  // which is why the two STEM sections and ABM A do not have identical lists.
  let offeringCount = 0;
  for (const section of SECTIONS) {
    for (const subject of SUBJECTS) {
      if (!subject.strands.includes(section.strand)) continue;
      await pool.query(
        `INSERT INTO class_offerings (subject_id, section_id, teacher_id, school_year_id)
         VALUES ($1, $2, $3, $4)`,
        [
          subjectIdByCode.get(subject.code),
          sectionIdByName.get(section.name),
          userIdByEmail.get(subject.teacher),
          schoolYearId,
        ]
      );
      offeringCount += 1;
    }
  }

  // --- Students -------------------------------------------------------------
  // Personal emails are included for most, because the registrar collects one
  // when the record is created and a portal account needs it. A couple are
  // deliberately left without one, which is the case the UI renders as
  // "No email on file".
  let loginCount = 0;
  for (const student of STUDENTS) {
    const flags = student.flags || {};
    const result = await pool.query(
      `INSERT INTO students
         (lrn, first_name, middle_name, last_name, sex, date_of_birth, address, email,
          guardian_name, guardian_contact_number, current_section_id, enrollment_status,
          is_pwd, is_4ps, is_als_graduate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        student.lrn,
        student.first,
        student.middle,
        student.last,
        student.sex,
        '2009-05-01',
        'Bacoor City, Cavite',
        student.email || null,
        `Mr./Mrs. ${student.last}`,
        '09171234567',
        sectionIdByName.get(student.section),
        student.enrollmentStatus || 'enrolled',
        flags.isPwd === true,
        flags.is4ps === true,
        flags.isAlsGraduate === true,
      ]
    );

    // A portal login for the handful of students the demo signs in as. The
    // account email is the student's own unless the dataset pins one (Carlo
    // keeps student@studentportal.local, and has no email on his record).
    if (student.login) {
      const loginEmail = student.loginEmail || student.email;
      const userId = await upsertUser(loginEmail, `${student.first} ${student.last}`, 'student');
      await pool.query('UPDATE students SET user_id = $2 WHERE id = $1', [result.rows[0].id, userId]);
      loginCount += 1;
    }
  }

  console.log(`Sample data seeded (school year 2026-2027):`);
  console.log(`  ${STAFF.length} staff accounts, one per role (password: ${DEMO_PASSWORD})`);
  console.log(`  ${SECTIONS.length} sections, ${SUBJECTS.length} subjects, ${offeringCount} class offerings`);
  console.log(`  ${STUDENTS.length} students, ${loginCount} with portal logins`);
  console.log(`  Grading periods: Q1 Jun1-Sep15, Q2 Sep16-Dec31, Q3 Jan1-Mar31`);
  console.log(`\nNext: npm run seed:demo-data  (grades, attendance, interventions, announcements)`);
}

seed()
  .catch((error) => {
    console.error('Failed to seed sample data:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
