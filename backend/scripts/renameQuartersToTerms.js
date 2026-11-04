// Renames a deployment's grading periods from Q1/Q2/Q3 to Term 1/2/3 —
// without reseeding.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A MIGRATION
//
// `grading_periods.name` is the SCHOOL'S OWN LABEL. It is free text they set
// in Academic Setup, and a migration that rewrote it would overwrite
// whatever they had chosen on every deploy, for every school year, with no
// way to say no. Renaming is a decision, not a schema change.
//
// Seeds are not the answer either: `seedSampleData.js` opens with
// `TRUNCATE school_years RESTART IDENTITY CASCADE`, which destroys
// everything in the database. Fine on a laptop, not on a deployment
// somebody is about to demo.
//
// So this is the same shape as applyTeacherOverrides.js: additive,
// idempotent, transaction-wrapped, and it refuses rather than guesses.
//
// WHAT IT WILL AND WILL NOT TOUCH
//
// Only the CURRENT school year, and only a period whose name is exactly
// 'Q1', 'Q2' or 'Q3'. A period already called 'Term 1', or called anything
// else the school chose, is left alone and reported as such. Renaming is
// keyed on the name rather than on `sequence_number` precisely so this
// cannot quietly rewrite a label somebody picked deliberately.
//
// Usage, from the repository root:
//
//   npm run rename:terms
//
// Against the Railway deployment, where PGHOST is the private
// postgres.railway.internal and so is only reachable from inside the
// container (`railway run` executes locally and cannot see it):
//
//   npx @railway/cli ssh
//   $(readlink -f /proc/1/exe) backend/scripts/renameQuartersToTerms.js
//
// `/proc/1/exe` is the running app's own node binary — the container has
// neither node nor npm on its shell PATH, and this keeps working if the
// platform's node version changes.
require('dotenv').config();

const { pool } = require('../config/db');

// Old name -> new name. Nothing else is eligible.
const RENAMES = { Q1: 'Term 1', Q2: 'Term 2', Q3: 'Term 3' };

async function renameQuartersToTerms() {
  const client = await pool.connect();
  const renamed = [];
  const skipped = [];

  try {
    await client.query('BEGIN');

    const year = await client.query('SELECT id, label FROM school_years WHERE is_current = TRUE LIMIT 1');
    if (year.rowCount === 0) {
      throw new Error('No school year is marked current, so there is nothing to rename.');
    }
    const { id: schoolYearId, label: yearLabel } = year.rows[0];
    console.log(`\nSchool year: ${yearLabel}\n`);

    const periods = await client.query(
      'SELECT id, name, sequence_number FROM grading_periods WHERE school_year_id = $1 ORDER BY sequence_number',
      [schoolYearId]
    );
    if (periods.rowCount === 0) {
      throw new Error(`${yearLabel} has no grading periods, which is not a state this script can act on.`);
    }

    for (const period of periods.rows) {
      const newName = RENAMES[period.name];
      if (!newName) {
        skipped.push(`${period.sequence_number}. "${period.name}" — not a Q1/Q2/Q3 name, left alone`);
        continue;
      }

      // The uniqueness constraint is on (school_year_id, sequence_number),
      // not on the name, so a collision is not possible here — but a name
      // already taken by another period would still be confusing, so say so
      // rather than creating two periods called "Term 2".
      const clash = periods.rows.find((p) => p.id !== period.id && p.name === newName);
      if (clash) {
        skipped.push(`${period.sequence_number}. "${period.name}" — "${newName}" is already used by sequence ${clash.sequence_number}`);
        continue;
      }

      await client.query('UPDATE grading_periods SET name = $2 WHERE id = $1', [period.id, newName]);
      renamed.push(`${period.sequence_number}. ${period.name} -> ${newName}`);
    }

    await client.query('COMMIT');

    const report = (label, rows) => {
      if (rows.length === 0) return;
      console.log(`${label}:`);
      rows.forEach((r) => console.log(`   ${r}`));
      console.log('');
    };
    report('Renamed', renamed);
    report('Left alone', skipped);

    if (renamed.length === 0) {
      console.log('Nothing to do — no period in this school year is still called Q1, Q2 or Q3.\n');
    } else {
      console.log('Done. The name appears wherever a grading period is named: the grade');
      console.log('tabs, the report card, the top bar and the home page.\n');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nRolled back — nothing was renamed.\n  ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

renameQuartersToTerms();
