// Dev-only sample data so the Student Records and Attendance scoping rules
// (adviser -> own section, subject teacher -> own classes) can actually be
// exercised. Not meant for production use.
//
// Safe to re-run: it truncates school_years first, which cascades through
// every table that transitively references it (sections, class_offerings,
// students, grading_periods, both attendance tables, etc.) — so each run
// starts from a clean slate for academic/reference data. Test user accounts
// are left alone (upserted, not truncated) so logins stay stable across reseeds.
require('dotenv').config();

const { pool } = require('../config/db');
const userModel = require('../models/userModel');

async function upsertUser(email, fullName, role) {
  const existing = await userModel.findByEmail(email);
  if (existing) return existing.id;
  const user = await userModel.createUser({ email, password: 'Password123!', fullName, role });
  return user.id;
}

async function seed() {
  await pool.query('TRUNCATE school_years RESTART IDENTITY CASCADE');

  const adviser1Id = await upsertUser('adviser@studentportal.local', 'Test adviser', 'adviser');
  const adviser2Id = await upsertUser('adviser2@studentportal.local', 'Test adviser 2', 'adviser');
  const teacherId = await upsertUser('subject_teacher@studentportal.local', 'Test subject_teacher', 'subject_teacher');
  const studentUserId = await upsertUser('student@studentportal.local', 'Test student', 'student');

  // Covers "now" in this dev environment (PH school year runs June-March).
  const schoolYear = await pool.query(
    `INSERT INTO school_years (label, start_date, end_date, is_current)
     VALUES ('2026-2027', '2026-06-01', '2027-03-31', TRUE)
     RETURNING id`
  );
  const schoolYearId = schoolYear.rows[0].id;

  const periods = [
    ['Q1', 1, '2026-06-01', '2026-08-15'],
    ['Q2', 2, '2026-08-16', '2026-10-31'], // covers "today" in this dev environment
    ['Q3', 3, '2026-11-01', '2027-01-15'],
    ['Q4', 4, '2027-01-16', '2027-03-31'],
  ];
  for (const [name, sequenceNumber, startDate, endDate] of periods) {
    await pool.query(
      `INSERT INTO grading_periods (school_year_id, name, sequence_number, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [schoolYearId, name, sequenceNumber, startDate, endDate]
    );
  }

  async function insertSection(name, gradeLevel, strand, adviserId) {
    const result = await pool.query(
      `INSERT INTO sections (school_year_id, grade_level, strand, name, adviser_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [schoolYearId, gradeLevel, strand, name, adviserId]
    );
    return result.rows[0].id;
  }

  // subject_teacher teaches both STEM sections (across two different
  // advisory sections) but not ABM A — this is the "regardless of advisory
  // section" case the Student Records / Attendance modules need to handle.
  const stemAId = await insertSection('STEM A', 11, 'STEM', adviser1Id);
  const stemBId = await insertSection('STEM B', 11, 'STEM', adviser2Id);
  const abmAId = await insertSection('ABM A', 11, 'ABM', adviser2Id);

  const subject = await pool.query(
    `INSERT INTO subjects (name, code, grade_level)
     VALUES ('General Mathematics', 'MATH11', 11)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const subjectId = subject.rows[0].id;

  async function insertOffering(sectionId) {
    const result = await pool.query(
      `INSERT INTO class_offerings (subject_id, section_id, teacher_id, school_year_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [subjectId, sectionId, teacherId, schoolYearId]
    );
    return result.rows[0].id;
  }
  const stemAOfferingId = await insertOffering(stemAId);
  const stemBOfferingId = await insertOffering(stemBId);
  // Deliberately no offering for ABM A.

  // enrollment_status starts 'pending' (the schema default) rather than
  // hardcoded 'enrolled', so the seed data actually exercises the real
  // enrollment-document review flow instead of skipping past it. Personal
  // emails are included so account auto-provisioning (see
  // services/accountProvisioning.js) can be exercised by flipping
  // enrollment_status to 'enrolled' on any of these without extra setup —
  // except Carlo, who's deliberately left without one to also cover the
  // "no email on file yet" path.
  async function insertStudent(lrn, firstName, lastName, sectionId, userId = null, email = null) {
    const result = await pool.query(
      `INSERT INTO students (lrn, first_name, last_name, sex, date_of_birth, current_section_id, user_id, email)
       VALUES ($1, $2, $3, 'F', '2009-05-01', $4, $5, $6)
       RETURNING id`,
      [lrn, firstName, lastName, sectionId, userId, email]
    );
    return result.rows[0].id;
  }

  await insertStudent('100000000001', 'Ana', 'Reyes', stemAId, null, 'ana.reyes.student@example.com');
  await insertStudent('100000000002', 'Ben', 'Cruz', stemAId, null, 'ben.cruz.student@example.com');
  await insertStudent('100000000003', 'Carlo', 'Santos', stemBId, studentUserId); // linked to the student test login, no personal email on file
  await insertStudent('100000000004', 'Dina', 'Lopez', stemBId, null, 'dina.lopez.student@example.com');
  await insertStudent('100000000005', 'Eve', 'Garcia', abmAId, null, 'eve.garcia.student@example.com');
  await insertStudent('100000000006', 'Fred', 'Torres', abmAId, null, 'fred.torres.student@example.com');

  console.log('Sample data seeded (school year 2026-2027):');
  console.log(`  STEM A (section id ${stemAId}, adviser@studentportal.local): Ana Reyes, Ben Cruz`);
  console.log(`  STEM B (section id ${stemBId}, adviser2@studentportal.local): Carlo Santos (linked to student@studentportal.local), Dina Lopez`);
  console.log(`  ABM A  (section id ${abmAId}, adviser2@studentportal.local): Eve Garcia, Fred Torres`);
  console.log(`  subject_teacher@studentportal.local teaches General Mathematics:`);
  console.log(`    class_offering id ${stemAOfferingId} = STEM A, class_offering id ${stemBOfferingId} = STEM B (not ABM A)`);
  console.log('  Grading periods: Q1 Jun1-Aug15, Q2 Aug16-Oct31, Q3 Nov1-Jan15, Q4 Jan16-Mar31');
}

seed()
  .catch((error) => {
    console.error('Failed to seed sample data:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
