// One-off: give every grade that was TYPED before the Class Record existed
// a class record that computes to it, and store the breakdown.
//
// Run with: npm run backfill:class-records   (safe to run more than once)
//
// WHY. Grades are now computed from recorded scores (DepEd Order No. 015,
// s. 2026, Annex D). Grades entered before that change have a value but no
// scores, so the System could not show how they were computed. For the
// demo dataset — sample learners, never real ones — this creates a typical
// class record per class and term (quizzes, tasks, the two summative tests
// and the term exam) and, for each learner, scores that compute to the
// grade they already had. Values, statuses and the approval trail are not
// touched; only `grades.computation` is filled in. Every breakdown is
// produced by the real calculator and checked against the stored grade —
// a grade it cannot reproduce exactly is left alone and reported.
//
// Do not run this against real learners' data: real grades should get real
// scores, through the Class Record page or the spreadsheet import.
//
// RUN ON EVERY DEPLOY (`--on-deploy`, from railway.json's pre-deploy step)
// so the live demo shows class records without anyone running a script by
// hand. That is safe to repeat because of what it selects: only grades whose
// `computation` is empty. A grade can only be empty there if it was TYPED
// before the Class Record existed — POST /api/grades was removed on
// 2026-11-12, and every grade submitted since (Class Record or e-Class
// Record import) is stored with its breakdown. So after the first run every
// deploy finds nothing to do, and a real learner's computed grade is never
// touched. In this mode:
//   - an error is logged and the deploy carries on (exit 0) — sample data
//     must never stop the app from deploying;
//   - BACKFILL_CLASS_RECORDS=false switches it off entirely, for when the
//     school runs the System with real learners.
require('dotenv').config();

const ON_DEPLOY = process.argv.includes('--on-deploy');
const { pool } = require('../config/db');
const { computeTermGrade } = require('../services/gradeCalculator');
const { GRADING_MODE } = require('../config/gradingPolicy');
const { demoItemsFor, scoresForGrade } = require('./lib/demoClassRecord');

async function main() {
  const groups = await pool.query(
    `SELECT g.class_offering_id, g.grading_period_id, subj.weight_group, MIN(g.recorded_by) AS recorded_by
     FROM grades g
     JOIN class_offerings co ON co.id = g.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     WHERE g.computation IS NULL
     GROUP BY g.class_offering_id, g.grading_period_id, subj.weight_group`
  );
  let filled = 0;
  let skipped = 0;

  for (const group of groups.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let items = (
        await client.query(
          `SELECT id, component, exam_part, title, highest_possible_score FROM assessment_items
           WHERE class_offering_id = $1 AND grading_period_id = $2 ORDER BY id`,
          [group.class_offering_id, group.grading_period_id]
        )
      ).rows;
      if (items.length === 0) {
        for (const [index, spec] of demoItemsFor(group.weight_group).entries()) {
          const row = await client.query(
            `INSERT INTO assessment_items (class_offering_id, grading_period_id, component, exam_part, title, highest_possible_score, sequence, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, component, exam_part, title, highest_possible_score`,
            [group.class_offering_id, group.grading_period_id, spec.component, spec.examPart, spec.title, spec.highestPossibleScore, index + 1, group.recorded_by]
          );
          items.push(row.rows[0]);
        }
      }
      items = items.map((r) => ({ id: r.id, component: r.component, examPart: r.exam_part, title: r.title, highestPossibleScore: Number(r.highest_possible_score) }));

      const grades = (
        await client.query(
          `SELECT id, student_id, grade_value, recorded_by FROM grades
           WHERE class_offering_id = $1 AND grading_period_id = $2 AND computation IS NULL`,
          [group.class_offering_id, group.grading_period_id]
        )
      ).rows;

      for (const grade of grades) {
        const target = Number(grade.grade_value);
        const scores = scoresForGrade({ items, termGrade: target, weightGroup: group.weight_group, seed: grade.student_id * 31 + group.grading_period_id });
        const computed = scores && computeTermGrade({ items, scores, weightGroup: group.weight_group, mode: GRADING_MODE });
        if (!computed || computed.termGrade !== target) {
          skipped += 1;
          console.log(`  could not reproduce grade ${target} (grade id ${grade.id}) — left without a breakdown`);
          continue;
        }
        for (const [itemId, raw] of scores) {
          await client.query(
            `INSERT INTO assessment_scores (assessment_item_id, student_id, raw_score, recorded_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (assessment_item_id, student_id) DO UPDATE SET raw_score = EXCLUDED.raw_score`,
            [itemId, grade.student_id, raw, grade.recorded_by]
          );
        }
        await client.query('UPDATE grades SET computation = $2 WHERE id = $1', [
          grade.id,
          JSON.stringify({ ...computed, computedAt: new Date().toISOString(), source: 'DepEd Order No. 015, s. 2026, Annex D' }),
        ]);
        filled += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  const summary = `Backfilled ${filled} grade(s) across ${groups.rows.length} class/term record(s); ${skipped} could not be reproduced.`;
  return { filled, skipped, summary };
}

// Used by server.js on a deployment (services/demoClassRecordsOnStart.js),
// where the pool stays open for the app. Run directly, it is the CLI below.
module.exports = { backfillClassRecords: main };

if (require.main === module) {
  if (ON_DEPLOY && String(process.env.BACKFILL_CLASS_RECORDS).toLowerCase() === 'false') {
    console.log('Class-record backfill skipped: BACKFILL_CLASS_RECORDS=false.');
    process.exit(0);
  }
  main()
    .then(async ({ summary }) => {
      console.log(summary);
      await pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end().catch(() => {});
      if (ON_DEPLOY) {
        console.error('Class-record backfill failed; the deploy continues without it.');
        process.exit(0);
      }
      process.exit(1);
    });
}
