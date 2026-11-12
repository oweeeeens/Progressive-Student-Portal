// Writes a filled-in DepEd e-Class Record for one demo class, for
// demonstrating the importer (Class Record → Import e-Class Record).
//
// Run with: npm run sample:eclass-record -- "<section name>" "<subject name>"
//   default: "STEM A" "General Mathematics"
// Output:   samples/eclass-record-<section>-<subject>.xlsx
//
// The workbook carries the class's current items and scores from the System
// — the demo dataset, never real learners — in the official ECR layout, and
// the term grade the workbook would show. Importing it back therefore shows
// a cross-check where every grade matches, which is the point to make in
// front of a panel: the System reads DepEd's own file and arrives at DepEd's
// own numbers.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const assessmentModel = require('../models/assessmentModel');
const { buildClassRecord } = require('../services/classRecordService');
const { buildEclassWorkbook } = require('./lib/eclassWorkbook');

const KEY_FOR = (item, counters) => {
  if (item.component === 'ex') return item.examPart;
  counters[item.component] += 1;
  return `${item.component}${counters[item.component]}`;
};

async function main() {
  const [sectionName = 'STEM A', subjectName = 'General Mathematics'] = process.argv.slice(2);
  const found = await pool.query(
    `SELECT co.id FROM class_offerings co
     JOIN sections sec ON sec.id = co.section_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN school_years sy ON sy.id = co.school_year_id
     WHERE sec.name = $1 AND subj.name = $2 AND sy.is_current = TRUE AND co.is_active = TRUE
     LIMIT 1`,
    [sectionName, subjectName]
  );
  if (found.rowCount === 0) throw new Error(`No class "${subjectName}" for section "${sectionName}" in the current school year.`);
  const offering = await assessmentModel.getOfferingContext(found.rows[0].id);
  const periods = (await pool.query('SELECT id, sequence_number FROM grading_periods WHERE school_year_id = $1 ORDER BY sequence_number', [offering.school_year_id])).rows;
  const learners = (await pool.query(
    `SELECT id, lrn, first_name, last_name, sex FROM students WHERE current_section_id = $1 AND is_active = TRUE ORDER BY last_name, first_name`,
    [offering.section_id]
  )).rows;

  const terms = [];
  for (const period of periods) {
    const record = await buildClassRecord(offering, period.id);
    if (record.items.length === 0) continue;
    const counters = { ww: 0, pt: 0 };
    const keyById = {};
    const hps = {};
    for (const item of record.items) {
      const key = KEY_FOR(item, counters);
      keyById[item.id] = key;
      hps[key] = item.highestPossibleScore;
    }
    const scores = {};
    const termGrades = {};
    for (const learner of record.learners) {
      const lrn = learners.find((l) => l.id === learner.studentId)?.lrn;
      if (!lrn) continue;
      scores[lrn] = Object.fromEntries(Object.entries(learner.scores).map(([itemId, raw]) => [keyById[itemId], raw]));
      if (learner.computed.termGrade !== null) termGrades[lrn] = learner.computed.termGrade;
    }
    terms.push({ sequence: period.sequence_number, hps, scores, termGrades });
  }

  const buffer = await buildEclassWorkbook({
    section: `Grade ${offering.grade_level} - ${offering.section_name}`,
    subject: offering.subject_name,
    teacher: '',
    gradeLevel: offering.grade_level,
    weightGroup: offering.weight_group,
    learners: learners.map((l) => ({
      lrn: l.lrn,
      name: `${l.last_name}, ${l.first_name}`,
      gender: String(l.sex || '').toLowerCase().startsWith('f') ? 'female' : 'male',
    })),
    terms,
  });
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const out = path.join(__dirname, '..', '..', 'samples', `eclass-record-${slug(sectionName)}-${slug(subjectName)}.xlsx`);
  fs.writeFileSync(out, buffer);
  console.log(`Wrote ${out} (${terms.length} term(s), ${learners.length} learners).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
