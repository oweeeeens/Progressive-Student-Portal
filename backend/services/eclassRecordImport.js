// Turns a parsed DepEd e-Class Record into an import PLAN for one class
// offering, and writes a plan. The same buildImportPlan runs at review and
// again at commit (the browser sends the parsed terms back), so nothing the
// browser says is trusted at write time — the stateless pattern the
// attendance importer uses.
//
// What the plan answers, per term in the workbook:
//   - which grading period it is (matched by sequence number within the
//     class's school year — "Term 2" is the period numbered 2);
//   - which learners it found, matched to THIS section's roster by LRN,
//     falling back to the name; who could not be matched; which roster
//     learners the file does not mention;
//   - the CROSS-CHECK: the term grade the System computes from the imported
//     scores (DepEd DO 015 formula, the subject's own weight group) beside
//     the term grade the workbook itself computed. A mismatch almost always
//     means the subject's weight group in the System is not the one the
//     workbook used;
//   - whether the term already has items here (then the user must choose
//     replace or skip), and whether any grade in it is finalized (then it
//     is locked: the official record is not overwritten by an import).
// It never submits grades: after importing, the teacher reviews the Class
// Record and submits it into the approval chain as usual.
const { pool } = require('../config/db');
const assessmentModel = require('../models/assessmentModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const bulkImportModel = require('../models/bulkImportModel');
const { computeTermGrade } = require('./gradeCalculator');
const { offeringCoversPeriod } = require('../config/academicTerms');
const { GRADING_MODE } = require('../config/gradingPolicy');

const DECISIONS = ['replace', 'skip'];

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-zñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadRoster(sectionId) {
  const result = await pool.query(
    `SELECT id, lrn, first_name, last_name FROM students
     WHERE current_section_id = $1 AND is_active = TRUE ORDER BY last_name, first_name`,
    [sectionId]
  );
  return result.rows;
}

// LRN first (it is unique); then "Last, First" at the start of the sheet's
// "Last, First Middle". Each roster learner is matched at most once.
function matchLearner(learner, roster, taken) {
  if (learner.lrn) {
    const byLrn = roster.find((s) => String(s.lrn) === learner.lrn && !taken.has(s.id));
    if (byLrn) return { student: byLrn, matchedBy: 'LRN' };
  }
  const sheetName = normalizeName(learner.name);
  const byName = roster.filter((s) => !taken.has(s.id) && sheetName.startsWith(normalizeName(`${s.last_name} ${s.first_name}`)));
  if (byName.length === 1) return { student: byName[0], matchedBy: 'name' };
  return null;
}

// Basic shape check on terms coming back from the browser at commit.
function sanitizeTerms(terms) {
  if (!Array.isArray(terms)) return [];
  return terms
    .filter((t) => t && Number.isInteger(Number(t.sequence)) && Array.isArray(t.items) && Array.isArray(t.learners))
    .map((t) => ({
      sequence: Number(t.sequence),
      sheetName: String(t.sheetName || ''),
      section: String(t.section || ''),
      subject: String(t.subject || ''),
      items: t.items
        .filter((i) => ['ww', 'pt', 'ex'].includes(i.component) && Number(i.highestPossibleScore) > 0)
        .map((i) => ({
          key: String(i.key),
          component: i.component,
          examPart: i.component === 'ex' ? i.examPart : null,
          title: String(i.title).slice(0, 120),
          highestPossibleScore: Number(i.highestPossibleScore),
        })),
      learners: t.learners.map((l) => ({
        row: Number(l.row),
        name: String(l.name || ''),
        lrn: l.lrn ? String(l.lrn).replace(/\D/g, '') : null,
        scores: l.scores && typeof l.scores === 'object' ? l.scores : {},
        sheetInitialGrade: l.sheetInitialGrade === null || l.sheetInitialGrade === undefined ? null : Number(l.sheetInitialGrade),
        sheetTermGrade: l.sheetTermGrade === null || l.sheetTermGrade === undefined ? null : Number(l.sheetTermGrade),
      })),
    }));
}

async function buildImportPlan(offering, rawTerms) {
  const terms = sanitizeTerms(rawTerms);
  const periods = await gradingPeriodModel.listBySchoolYear(offering.school_year_id);
  const roster = await loadRoster(offering.section_id);
  const planTerms = [];

  for (const term of terms) {
    const period = periods.find((p) => p.sequence_number === term.sequence);
    const base = { sequence: term.sequence, sheetName: term.sheetName, itemCount: term.items.length, items: term.items };
    if (!period) {
      planTerms.push({ ...base, status: 'no_period', reason: `This school year has no grading period numbered ${term.sequence}.` });
      continue;
    }
    if (!offeringCoversPeriod({ term: offering.term, subjectCategory: offering.subject_category, periodSequenceNumber: period.sequence_number })) {
      planTerms.push({ ...base, periodId: period.id, periodName: period.name, status: 'not_taught', reason: `${offering.subject_name} is not taught in ${period.name} for this section.` });
      continue;
    }

    const existingItems = await assessmentModel.listItems(offering.id, period.id);
    const grades = await assessmentModel.listGradesForOffering(offering.id, period.id);
    const finalizedIds = new Set(grades.filter((g) => g.status === 'finalized').map((g) => g.student_id));
    // Replacing a term's items deletes their scores; with any finalized grade
    // in the term that would rewrite the official record, so it is locked.
    const locked = existingItems.length > 0 && finalizedIds.size > 0;

    const taken = new Set();
    const learners = [];
    const unmatched = [];
    const itemsById = term.items.map((i) => ({ ...i, id: i.key }));
    for (const learner of term.learners) {
      const match = matchLearner(learner, roster, taken);
      if (!match) {
        unmatched.push({ row: learner.row, name: learner.name, lrn: learner.lrn });
        continue;
      }
      taken.add(match.student.id);
      const invalid = term.items.filter((i) => {
        const v = learner.scores[i.key];
        return v !== undefined && (Number(v) < 0 || Number(v) > i.highestPossibleScore);
      });
      const scores = new Map(Object.entries(learner.scores).map(([k, v]) => [k, Number(v)]));
      const computed = computeTermGrade({ items: itemsById, scores, weightGroup: offering.weight_group, mode: GRADING_MODE });
      const mismatch = computed.complete && learner.sheetTermGrade !== null && Math.round(learner.sheetTermGrade) !== computed.termGrade;
      learners.push({
        row: learner.row,
        name: learner.name,
        studentId: match.student.id,
        studentName: `${match.student.last_name}, ${match.student.first_name}`,
        matchedBy: match.matchedBy,
        scoreCount: scores.size,
        missingCount: term.items.length - scores.size,
        invalidItems: invalid.map((i) => i.title),
        finalized: finalizedIds.has(match.student.id),
        sheetTermGrade: learner.sheetTermGrade,
        computedTermGrade: computed.termGrade,
        mismatch,
      });
    }
    const notInFile = roster.filter((s) => !taken.has(s.id)).map((s) => ({ studentId: s.id, name: `${s.last_name}, ${s.first_name}` }));

    planTerms.push({
      ...base,
      periodId: period.id,
      periodName: period.name,
      status: locked ? 'locked' : 'ready',
      reason: locked ? `${period.name} already has finalized grades, so its class record cannot be replaced by an import.` : null,
      existingItemCount: existingItems.length,
      needsDecision: existingItems.length > 0 && !locked,
      learners,
      unmatched,
      notInFile,
      mismatchCount: learners.filter((l) => l.mismatch).length,
      comparedCount: learners.filter((l) => l.computedTermGrade !== null && l.sheetTermGrade !== null).length,
    });
  }

  const header = terms[0] || {};
  return {
    workbook: { section: header.section || '', subject: header.subject || '' },
    terms: planTerms,
  };
}

// Writes the plan's ready terms in one transaction. `decisions` maps a term
// sequence to 'replace' or 'skip' for terms that already have items.
async function commitImportPlan({ offering, rawTerms, plan, decisions, userId, fileName }) {
  const terms = sanitizeTerms(rawTerms);
  const toWrite = plan.terms.filter((t) => t.status === 'ready' && !(t.needsDecision && decisions[t.sequence] === 'skip'));
  const client = await pool.connect();
  let itemCount = 0;
  let scoreCount = 0;
  try {
    await client.query('BEGIN');
    const log = await bulkImportModel.logImport({
      performedBy: userId,
      fileName: fileName || 'e-class-record.xlsx',
      totalRows: plan.terms.reduce((sum, t) => sum + (t.learners ? t.learners.length + t.unmatched.length : 0), 0),
      successCount: 0,
      errorCount: plan.terms.reduce((sum, t) => sum + (t.unmatched ? t.unmatched.length : 0), 0),
      columnMapping: { classOfferingId: offering.id, terms: toWrite.map((t) => t.sequence), decisions },
      importType: 'class_record',
      client,
    });

    for (const planTerm of toWrite) {
      const term = terms.find((t) => t.sequence === planTerm.sequence);
      if (planTerm.existingItemCount > 0) {
        await client.query('DELETE FROM assessment_items WHERE class_offering_id = $1 AND grading_period_id = $2', [offering.id, planTerm.periodId]);
      }
      const idByKey = {};
      for (const item of term.items) {
        const row = await assessmentModel.createItem(
          {
            classOfferingId: offering.id,
            gradingPeriodId: planTerm.periodId,
            component: item.component,
            examPart: item.examPart,
            title: item.title,
            highestPossibleScore: item.highestPossibleScore,
            createdBy: userId,
            importId: log.id,
          },
          client
        );
        idByKey[item.key] = row.id;
        itemCount += 1;
      }
      const writable = planTerm.learners.filter((l) => !l.finalized && l.invalidItems.length === 0);
      const entries = [];
      for (const learner of writable) {
        const source = term.learners.find((l) => l.row === learner.row);
        for (const [key, value] of Object.entries(source.scores)) {
          if (idByKey[key] !== undefined) entries.push({ itemId: idByKey[key], studentId: learner.studentId, rawScore: Number(value) });
        }
      }
      await assessmentModel.saveScores(entries, userId, client);
      scoreCount += entries.length;
    }
    await bulkImportModel.updateImportCounts(log.id, { successCount: scoreCount }, client);
    await client.query('COMMIT');
    return { importId: log.id, termsWritten: toWrite.map((t) => t.periodName), itemCount, scoreCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { buildImportPlan, commitImportPlan, DECISIONS };
