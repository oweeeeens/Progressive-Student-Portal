// Gives every current learner a class record in every class they take, for
// every term that has started — the demo deployment's sample data.
//
// Run with: npm run fill:demo-class-records        (safe to run more than once)
// On Railway it runs on every deploy, after the backfill (`--on-deploy`, from
// `npm run deploy:prepare`).
//
// WHY THIS EXISTS BESIDE THE BACKFILL. backfillClassRecords.js builds a
// record BEHIND A GRADE THAT ALREADY EXISTS. On the live demo many learners
// have no grade at all in many classes (learners and classes the group added
// by hand, or terms nobody seeded), so the backfill had nothing to start
// from and their Class Record stayed empty. This fills exactly those gaps.
//
// WHAT IT CREATES, per active class this school year × each term that has
// started (by the school's local date) × each active learner of the section:
//   - Scores, only for a learner with NO score yet in that class and term,
//     on the class's existing items — or, when the class has none for that
//     term, on a typical DepEd-shaped set (scripts/lib/demoClassRecord.js).
//   - For a term that has ENDED, and only where the learner has no grade
//     row at all: the computed grade, entered as FINALIZED with its
//     breakdown, so it counts for risk, outlook and analytics like any
//     official grade. (The group's choice: Term 1 is over, so its grades are
//     official.)
//   - For the CURRENT term: scores only. The Class Record then shows a
//     provisional computed grade the teacher still submits — which is also
//     what Learner Outlook's early warning reads.
// It never changes an existing grade, its status or its approval trail, and
// never adds to a learner who already has any score in that class and term.
// So a second run finds nothing to do.
//
// The grade each learner gets is deterministic (seeded by learner, class and
// term) and believable: near the learner's own average where they already
// have grades — a struggling learner stays struggling — otherwise spread
// between about 70 and 95 with roughly one in six below 75, so the risk and
// outlook views have something to show. Every set of scores is produced by
// the real calculator and checked to reproduce the grade.
//
// Sample data only. BACKFILL_CLASS_RECORDS=false switches it off (together
// with the backfill) once the school uses the System with real learners;
// with --on-deploy a failure is logged and the deploy carries on.
require('dotenv').config();
const { pool } = require('../config/db');
const { computeTermGrade } = require('../services/gradeCalculator');
const { GRADING_MODE } = require('../config/gradingPolicy');
const { offeringCoversPeriod } = require('../config/academicTerms');
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const { demoItemsFor, scoresForGrade } = require('./lib/demoClassRecord');

const ON_DEPLOY = process.argv.includes('--on-deploy');
const LOWEST_TARGET = 65;
const HIGHEST_TARGET = 98;

// A repeatable number in [0, 1) from a few integers — the same learner,
// class and term always get the same grade, so runs agree with each other.
function seeded(...parts) {
  const x = Math.sin(parts.reduce((acc, n, i) => acc + n * (i + 1) * 7919, 0)) * 10000;
  return x - Math.floor(x);
}

// The grade this learner's scores should compute to.
function targetGrade({ studentId, offeringId, periodId, ownAverage }) {
  const r = seeded(studentId, offeringId, periodId);
  let grade;
  if (ownAverage !== null) {
    grade = ownAverage + (r * 8 - 4); // their usual level, ±4
  } else if (seeded(studentId, 17) < 1 / 6) {
    grade = 68 + r * 6; // the learners who are struggling: 68–74
  } else {
    grade = 76 + r * 19; // everyone else: 76–95
  }
  return Math.min(HIGHEST_TARGET, Math.max(LOWEST_TARGET, Math.round(grade)));
}

// First active user with a role, for the approval trail of a finalized
// grade when the class or section has no assigned person.
async function firstUserWithRole(role) {
  const r = await pool.query('SELECT id FROM users WHERE role = $1 AND is_active = TRUE ORDER BY id LIMIT 1', [role]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function main() {
  const today = todayInSchoolTimezone();
  const year = (await pool.query('SELECT id, label FROM school_years WHERE is_current = TRUE LIMIT 1')).rows[0];
  if (!year) {
    return { summary: 'No school year is marked current — nothing to fill. Set one in Academic Setup → School Years.' };
  }
  const periods = (
    await pool.query(
      `SELECT id, name, sequence_number, start_date, end_date FROM grading_periods
       WHERE school_year_id = $1 AND start_date <= $2 ORDER BY sequence_number`,
      [year.id, today]
    )
  ).rows;
  const offerings = (
    await pool.query(
      `SELECT co.id, co.term, co.teacher_id, co.section_id,
              subj.weight_group, subj.category AS subject_category, sec.adviser_id
       FROM class_offerings co
       JOIN subjects subj ON subj.id = co.subject_id
       JOIN sections sec ON sec.id = co.section_id
       WHERE co.school_year_id = $1 AND co.is_active = TRUE AND sec.is_active = TRUE
       ORDER BY co.id`,
      [year.id]
    )
  ).rows;
  const admin = await firstUserWithRole('admin');
  const principal = (await firstUserWithRole('principal')) || admin;

  // Each learner's own average so far this year, to keep their new marks in
  // character. Read once, before anything is written.
  const averages = new Map(
    (
      await pool.query(
        `SELECT g.student_id, AVG(g.grade_value)::float AS average
         FROM grades g JOIN grading_periods gp ON gp.id = g.grading_period_id
         WHERE gp.school_year_id = $1 GROUP BY g.student_id`,
        [year.id]
      )
    ).rows.map((r) => [r.student_id, r.average])
  );

  let records = 0;
  let learnersFilled = 0;
  let gradesFinalized = 0;
  let skipped = 0;
  const finalizedByPeriod = new Map(); // periodId -> Set(studentId), for the risk recalculation

  for (const offering of offerings) {
    for (const period of periods) {
      if (!offeringCoversPeriod({ term: offering.term, subjectCategory: offering.subject_category, periodSequenceNumber: period.sequence_number })) continue;
      const ended = String(period.end_date) < today;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const owner = offering.teacher_id || admin;

        // Learners of the section with no score at all in this class and
        // term. Asked before items are created, so a learner is only ever
        // filled once.
        const learners = (
          await client.query(
            `SELECT s.id FROM students s
             WHERE s.current_section_id = $1 AND s.is_active = TRUE
               AND NOT EXISTS (
                 SELECT 1 FROM assessment_scores sc
                 JOIN assessment_items ai ON ai.id = sc.assessment_item_id
                 WHERE sc.student_id = s.id AND ai.class_offering_id = $2 AND ai.grading_period_id = $3)
             ORDER BY s.id`,
            [offering.section_id, offering.id, period.id]
          )
        ).rows;
        if (learners.length === 0) {
          await client.query('ROLLBACK');
          continue;
        }

        let items = (
          await client.query(
            `SELECT id, component, exam_part, title, highest_possible_score FROM assessment_items
             WHERE class_offering_id = $1 AND grading_period_id = $2 ORDER BY sequence, id`,
            [offering.id, period.id]
          )
        ).rows;
        if (items.length === 0) {
          for (const [index, spec] of demoItemsFor(offering.weight_group).entries()) {
            const row = await client.query(
              `INSERT INTO assessment_items (class_offering_id, grading_period_id, component, exam_part, title, highest_possible_score, sequence, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id, component, exam_part, title, highest_possible_score`,
              [offering.id, period.id, spec.component, spec.examPart, spec.title, spec.highestPossibleScore, index + 1, owner]
            );
            items.push(row.rows[0]);
          }
        }
        items = items.map((r) => ({ id: r.id, component: r.component, examPart: r.exam_part, title: r.title, highestPossibleScore: Number(r.highest_possible_score) }));

        // Existing grade rows in this class and term: their learners get
        // scores matching THAT grade, and no new grade.
        const existing = new Map(
          (
            await client.query('SELECT student_id, grade_value FROM grades WHERE class_offering_id = $1 AND grading_period_id = $2', [offering.id, period.id])
          ).rows.map((r) => [r.student_id, Number(r.grade_value)])
        );

        for (const { id: studentId } of learners) {
          const target = existing.has(studentId)
            ? Math.round(existing.get(studentId))
            : targetGrade({ studentId, offeringId: offering.id, periodId: period.id, ownAverage: averages.has(studentId) ? averages.get(studentId) : null });
          const scores = scoresForGrade({ items, termGrade: target, weightGroup: offering.weight_group, seed: studentId * 31 + period.id + offering.id * 7 });
          const computed = scores && computeTermGrade({ items, scores, weightGroup: offering.weight_group, mode: GRADING_MODE });
          if (!computed || computed.termGrade !== target) {
            skipped += 1;
            continue;
          }
          for (const [itemId, raw] of scores) {
            await client.query(
              `INSERT INTO assessment_scores (assessment_item_id, student_id, raw_score, recorded_by)
               VALUES ($1, $2, $3, $4) ON CONFLICT (assessment_item_id, student_id) DO NOTHING`,
              [itemId, studentId, raw, owner]
            );
          }
          learnersFilled += 1;

          if (ended && !existing.has(studentId)) {
            const snapshot = JSON.stringify({ ...computed, computedAt: new Date().toISOString(), source: 'DepEd Order No. 015, s. 2026, Annex D' });
            const inserted = await client.query(
              `INSERT INTO grades (student_id, class_offering_id, grading_period_id, grade_value, recorded_by, recorded_at,
                                   status, verified_by, verified_at, finalized_by, finalized_at, computation)
               VALUES ($1, $2, $3, $4, $5, now(), 'finalized', $6, now(), $7, now(), $8)
               ON CONFLICT (student_id, class_offering_id, grading_period_id) DO NOTHING
               RETURNING id`,
              [studentId, offering.id, period.id, computed.termGrade, owner, principal, offering.adviser_id || admin, snapshot]
            );
            if (inserted.rowCount > 0) {
              gradesFinalized += 1;
              if (!finalizedByPeriod.has(period.id)) finalizedByPeriod.set(period.id, new Set());
              finalizedByPeriod.get(period.id).add(studentId);
            }
          }
        }
        await client.query('COMMIT');
        records += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  }

  // New official grades change a learner's risk: recalculate the term they
  // were finalized in, then every later term that has started, because the
  // trend reads across terms.
  if (finalizedByPeriod.size > 0) {
    const { recalculateRiskForStudents } = require('../services/riskEngine');
    const affected = new Set([...finalizedByPeriod.values()].flatMap((s) => [...s]));
    const firstSequence = Math.min(...periods.filter((p) => finalizedByPeriod.has(p.id)).map((p) => p.sequence_number));
    for (const period of periods.filter((p) => p.sequence_number >= firstSequence)) {
      await recalculateRiskForStudents([...affected], period.id);
    }
  }

  // What was looked at is part of the summary, so a deploy log that says
  // "0 learners" also says whether that is because everything is already
  // filled or because there was nothing to look at.
  const summary =
    `Class records filled for ${year.label} (${offerings.length} active class(es), ` +
    `${periods.length} term(s) started: ${periods.map((p) => p.name).join(', ') || 'none'}): ` +
    `${learnersFilled} learner(s) across ${records} class/term record(s); ` +
    `${gradesFinalized} grade(s) finalized for ended terms; ${skipped} could not be reproduced.`;
  return { learnersFilled, gradesFinalized, skipped, summary };
}

// Used by server.js on a deployment (services/demoClassRecordsOnStart.js),
// where the pool stays open for the app. Run directly, it is the CLI below.
module.exports = { fillDemoClassRecords: main };

if (require.main === module) {
  if (ON_DEPLOY && String(process.env.BACKFILL_CLASS_RECORDS).toLowerCase() === 'false') {
    console.log('Class-record fill skipped: BACKFILL_CLASS_RECORDS=false.');
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
        console.error('Class-record fill failed; the deploy continues without it.');
        process.exit(0);
      }
      process.exit(1);
    });
}
