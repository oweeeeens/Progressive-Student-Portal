// Makes the live class offerings match the teaching assignments the demo
// dataset describes — without reseeding.
//
// WHY THIS EXISTS. Seeds are run by hand, not as part of a deploy, so a
// change to demoDataset.js reaches a deployment only when somebody reseeds
// it. `seedSampleData.js` opens with
// `TRUNCATE school_years RESTART IDENTITY CASCADE`, which destroys everything
// in that database — fine on a laptop, not on a deployment somebody is about
// to demo. So when the only thing out of date is who teaches what, this
// applies that one difference and leaves the rest alone.
//
// It reads TEACHER_OVERRIDES from the dataset rather than hard-coding the
// rows, so the dataset stays the single source of truth and the live data
// cannot quietly drift from it.
//
// ADDITIVE AND IDEMPOTENT. It inserts missing offerings and corrects a
// wrong teacher_id. It never deletes, never truncates, and a second run
// reports everything as already correct and writes nothing.
//
// Usage, from the repository root:
//
//   npm run apply:teaching
//
// Against the Railway deployment, where PGHOST is the private
// postgres.railway.internal and so is only reachable from inside the
// container (`railway run` executes locally and cannot see it):
//
//   npx @railway/cli ssh
//   $(readlink -f /proc/1/exe) backend/scripts/applyTeacherOverrides.js
//
// `/proc/1/exe` is the running app's own node binary — the container has
// neither node nor npm on its shell PATH, and this keeps working if the
// platform's node version changes.
require('dotenv').config();

const { pool } = require('../config/db');
const { TEACHER_OVERRIDES } = require('./demoDataset');
const { DEFAULT_CLASS_TERM } = require('../config/academicTerms');

async function applyTeacherOverrides() {
  const entries = Object.entries(TEACHER_OVERRIDES);
  if (entries.length === 0) {
    console.log('No teacher overrides defined in demoDataset.js — nothing to apply.');
    return;
  }

  const client = await pool.connect();
  const created = [];
  const reassigned = [];
  const unchanged = [];
  const problems = [];

  try {
    await client.query('BEGIN');

    // Everything is resolved inside the CURRENT school year. Section names
    // repeat across years ("STEM A" exists in each), so a lookup by name
    // alone could land on a previous year's section and move a teacher onto
    // a class nobody is teaching any more.
    const year = await client.query('SELECT id, label FROM school_years WHERE is_current = TRUE LIMIT 1');
    if (year.rowCount === 0) {
      throw new Error('No school year is marked current, so there is nothing to resolve sections against.');
    }
    const { id: schoolYearId, label: yearLabel } = year.rows[0];
    console.log(`\nSchool year: ${yearLabel}\n`);

    for (const [key, teacherEmail] of entries) {
      const [sectionName, subjectCode] = key.split('|');

      const section = await client.query(
        'SELECT id FROM sections WHERE name = $1 AND school_year_id = $2 AND is_active = TRUE',
        [sectionName, schoolYearId]
      );
      const subject = await client.query('SELECT id FROM subjects WHERE code = $1', [subjectCode]);
      const teacher = await client.query('SELECT id, full_name FROM users WHERE lower(email) = lower($1)', [
        teacherEmail,
      ]);

      // Refuse rather than guess. A missing row here means this deployment's
      // data differs from the dataset in some other way too, and silently
      // skipping would hide that.
      const missing = [
        section.rowCount === 0 && `section "${sectionName}"`,
        subject.rowCount === 0 && `subject "${subjectCode}"`,
        teacher.rowCount === 0 && `teacher "${teacherEmail}"`,
      ].filter(Boolean);
      if (missing.length > 0) {
        problems.push(`${key}: could not find ${missing.join(', ')}`);
        continue;
      }

      const sectionId = section.rows[0].id;
      const subjectId = subject.rows[0].id;
      const teacherId = teacher.rows[0].id;
      const teacherName = teacher.rows[0].full_name;

      const existing = await client.query(
        `SELECT co.id, co.teacher_id, u.full_name AS current_teacher
           FROM class_offerings co
           JOIN users u ON u.id = co.teacher_id
          WHERE co.subject_id = $1 AND co.section_id = $2 AND co.school_year_id = $3`,
        [subjectId, sectionId, schoolYearId]
      );

      if (existing.rowCount === 0) {
        // `term` must be given explicitly: it is NOT NULL and part of the
        // uniqueness constraint. full_year is right for these — a Grade 11
        // subject runs all three terms.
        await client.query(
          `INSERT INTO class_offerings (subject_id, section_id, teacher_id, school_year_id, term)
           VALUES ($1, $2, $3, $4, $5)`,
          [subjectId, sectionId, teacherId, schoolYearId, DEFAULT_CLASS_TERM]
        );
        created.push(`${subjectCode} -> ${sectionName}  (${teacherName})`);
      } else if (existing.rows[0].teacher_id !== teacherId) {
        await client.query('UPDATE class_offerings SET teacher_id = $1 WHERE id = $2', [
          teacherId,
          existing.rows[0].id,
        ]);
        reassigned.push(`${subjectCode} -> ${sectionName}  (${existing.rows[0].current_teacher} => ${teacherName})`);
      } else {
        unchanged.push(`${subjectCode} -> ${sectionName}  (${teacherName})`);
      }
    }

    if (problems.length > 0) {
      await client.query('ROLLBACK');
      console.error('Nothing was changed. Could not resolve:');
      problems.forEach((p) => console.error(`   ${p}`));
      console.error('\nThis deployment’s data differs from demoDataset.js by more than the teaching');
      console.error('assignments — worth looking at before applying anything.\n');
      process.exitCode = 1;
      return;
    }

    await client.query('COMMIT');

    const report = (label, rows) => {
      if (rows.length === 0) return;
      console.log(`${label}:`);
      rows.forEach((r) => console.log(`   ${r}`));
      console.log('');
    };
    report('Created', created);
    report('Reassigned', reassigned);
    report('Already correct', unchanged);

    if (created.length === 0 && reassigned.length === 0) {
      console.log('Nothing to do — every assignment already matches the dataset.\n');
    } else {
      console.log('Done. The affected teachers will see Enter Grades');
      console.log('on their next sign-in (the sidebar counts assignments once per session).\n');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nRolled back — nothing was changed.\n  ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

applyTeacherOverrides();
