// Handlers for the Class Record: the items a term is graded on (quizzes,
// tasks, summative tests, the term exam), each learner's scores on them,
// and submitting the COMPUTED term grades into the approval chain.
//
// This replaces typing a grade. DepEd Order No. 015, s. 2026, Annex D makes
// a term grade the result of a computation over recorded scores, and the
// research adviser's point was that a grade nobody can trace back to its
// scores is not a grade the school can stand behind. So the only way a
// grade now enters `grades` is POST /class-record/submit, which recomputes
// every learner on the server from the stored scores — numbers sent by the
// browser are never trusted.
//
// WHO MAY DO WHAT — by assignment, never by role label (CLAUDE.md):
//   read  : admin, the principal, whoever teaches the offering
//           (class_offerings.teacher_id), and the section's adviser
//           (sections.adviser_id), who finalizes these grades.
//   write : admin and whoever teaches the offering.
const assessmentModel = require('../models/assessmentModel');
const gradeModel = require('../models/gradeModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const { buildClassRecord, toItem } = require('../services/classRecordService');
const { offeringCoversPeriod } = require('../config/academicTerms');
const {
  COMPONENTS,
  EXAM_PARTS,
  WEIGHT_GROUPS,
  GRADING_MODE,
  TERM_EXAM_ONLY_GROUPS,
  TRANSMUTATION_TABLE,
  MINIMUM_REPORTABLE_GRADE,
} = require('../config/gradingPolicy');

function canRead(user, offering) {
  return (
    user.role === 'admin' ||
    user.role === 'principal' ||
    offering.teacher_id === user.id ||
    offering.adviser_id === user.id
  );
}

function canWrite(user, offering) {
  return user.role === 'admin' || offering.teacher_id === user.id;
}

// Loads and checks the offering + grading period every endpoint works on.
// Answers the request itself on any failure and returns null.
async function loadScope(req, res, { classOfferingId, gradingPeriodId }, { write = false } = {}) {
  const offeringId = Number(classOfferingId);
  const periodId = Number(gradingPeriodId);
  if (!Number.isInteger(offeringId) || offeringId <= 0 || !Number.isInteger(periodId) || periodId <= 0) {
    res.status(400).json({ error: 'classOfferingId and gradingPeriodId are required.' });
    return null;
  }
  const offering = await assessmentModel.getOfferingContext(offeringId);
  if (!offering) {
    res.status(404).json({ error: 'Class not found.' });
    return null;
  }
  if (write ? !canWrite(req.user, offering) : !canRead(req.user, offering)) {
    res.status(403).json({
      error: write ? 'Only the teacher of this class can change its class record.' : 'You can only open class records for classes you teach or advise.',
    });
    return null;
  }
  const period = await gradingPeriodModel.getById(periodId);
  if (!period || period.school_year_id !== offering.school_year_id) {
    res.status(400).json({ error: "That grading period is not in this class's school year." });
    return null;
  }
  // A Grade 12 subject offered for Term 1 only has no Term 2 class record.
  if (!offeringCoversPeriod({ term: offering.term, subjectCategory: offering.subject_category, periodSequenceNumber: period.sequence_number })) {
    res.status(400).json({ error: `${offering.subject_name} is not taught in ${period.name} for this section.` });
    return null;
  }
  return { offering, period };
}

// What the page needs to label the record: the subject's DepEd weight set
// and the exam parts that apply to it.
function describePolicy(offering) {
  const group = WEIGHT_GROUPS[offering.weight_group] ? offering.weight_group : 'core';
  const weights = WEIGHT_GROUPS[group];
  return {
    weightGroup: group,
    weightGroupLabel: weights.label,
    weights: { ww: weights.ww, pt: weights.pt, ex: weights.ex },
    examParts: weights.ex === null ? [] : TERM_EXAM_ONLY_GROUPS.has(group) ? ['te'] : Object.keys(EXAM_PARTS),
    // Sent so the page can preview a learner's grade as scores are typed
    // without keeping its own copy of DepEd's numbers. The server still
    // recomputes everything on save and submit.
    examPartWeights: Object.fromEntries(Object.entries(EXAM_PARTS).map(([k, v]) => [k, v.weight])),
    transmutationTable: TRANSMUTATION_TABLE,
    minimumGrade: MINIMUM_REPORTABLE_GRADE,
    mode: GRADING_MODE,
    source: 'DepEd Order No. 015, s. 2026, Annex D',
  };
}

// GET /api/class-record?classOfferingId=&gradingPeriodId=
async function getClassRecord(req, res) {
  const scope = await loadScope(req, res, req.query);
  if (!scope) return;
  const { offering, period } = scope;
  const record = await buildClassRecord(offering, period.id);
  res.json({
    offering: {
      id: offering.id,
      subjectName: offering.subject_name,
      subjectCode: offering.subject_code,
      sectionName: offering.section_name,
      gradeLevel: offering.grade_level,
    },
    period: { id: period.id, name: period.name },
    policy: describePolicy(offering),
    canEdit: canWrite(req.user, offering),
    ...record,
  });
}

// Validates an item body. Returns { ok, value } or { ok: false, error }.
function readItem(body, offering) {
  const component = body.component;
  if (!COMPONENTS[component]) return { ok: false, error: 'component must be ww, pt or ex.' };
  const policy = describePolicy(offering);
  if (component === 'ex' && policy.examParts.length === 0) {
    return { ok: false, error: `${policy.weightGroupLabel} subjects have no Examinations component (DO 015, Annex D Table 2).` };
  }
  const examPart = component === 'ex' ? body.examPart : null;
  if (component === 'ex' && !policy.examParts.includes(examPart)) {
    return { ok: false, error: `examPart must be one of: ${policy.examParts.join(', ')}.` };
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) return { ok: false, error: 'A title of up to 120 characters is required.' };
  const hps = Number(body.highestPossibleScore);
  if (!Number.isFinite(hps) || hps <= 0 || hps > 10000) {
    return { ok: false, error: 'The highest possible score must be a number greater than 0.' };
  }
  return { ok: true, value: { component, examPart, title, highestPossibleScore: Math.round(hps * 100) / 100 } };
}

// POST /api/class-record/items
async function createItem(req, res) {
  const scope = await loadScope(req, res, req.body, { write: true });
  if (!scope) return;
  const parsed = readItem(req.body, scope.offering);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const row = await assessmentModel.createItem({
    classOfferingId: scope.offering.id,
    gradingPeriodId: scope.period.id,
    ...parsed.value,
    createdBy: req.user.id,
  });
  res.status(201).json({ item: toItem(row) });
}

// Loads an item and checks the caller may change it. Changing or deleting
// an item that a finalized grade was computed from is refused: that grade
// is the official record (CLAUDE.md, "a finalized grade is final").
async function loadItemForWrite(req, res) {
  const item = await assessmentModel.getItem(Number(req.params.id));
  if (!item) {
    res.status(404).json({ error: 'Item not found.' });
    return null;
  }
  const scope = await loadScope(req, res, { classOfferingId: item.class_offering_id, gradingPeriodId: item.grading_period_id }, { write: true });
  if (!scope) return null;
  if (await assessmentModel.itemTouchesFinalizedGrade(item.id)) {
    res.status(409).json({ error: 'Grades for this class and term are already finalized, so its items can no longer be changed.' });
    return null;
  }
  return { item, scope };
}

// PATCH /api/class-record/items/:id — title and highest possible score.
// The component cannot change: that would silently move every score on it
// into a different weight.
async function updateItem(req, res) {
  const loaded = await loadItemForWrite(req, res);
  if (!loaded) return;
  const { item, scope } = loaded;
  const parsed = readItem({ ...req.body, component: item.component, examPart: item.exam_part }, scope.offering);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const highest = await assessmentModel.maxScoreOnItem(item.id);
  if (highest !== null && parsed.value.highestPossibleScore < highest) {
    return res.status(400).json({ error: `A learner already scored ${highest} on this item, so its highest possible score cannot be lower than that.` });
  }
  const row = await assessmentModel.updateItem(item.id, parsed.value);
  res.json({ item: toItem(row) });
}

// DELETE /api/class-record/items/:id — removes the item and its scores.
async function deleteItem(req, res) {
  const loaded = await loadItemForWrite(req, res);
  if (!loaded) return;
  await assessmentModel.deleteItem(loaded.item.id);
  res.status(204).end();
}

// PUT /api/class-record/scores
// Body: { classOfferingId, gradingPeriodId, scores: [{ itemId, studentId, rawScore }] }
// rawScore null clears a score. Every score is checked against its item's
// highest possible score, the learner against the roster, and learners whose
// grade is already finalized are refused — their scores are part of the
// official record.
async function saveScores(req, res) {
  const scope = await loadScope(req, res, req.body, { write: true });
  if (!scope) return;
  const { offering, period } = scope;
  const entries = Array.isArray(req.body.scores) ? req.body.scores : null;
  if (!entries || entries.length === 0) return res.status(400).json({ error: 'scores must be a non-empty array.' });

  const items = new Map((await assessmentModel.listItems(offering.id, period.id)).map((row) => [row.id, row]));
  const rosterIds = new Set((await gradeModel.getActiveStudentsInOffering(offering.id)).map((s) => s.id));
  const finalizedIds = new Set(
    (await assessmentModel.listGradesForOffering(offering.id, period.id)).filter((g) => g.status === 'finalized').map((g) => g.student_id)
  );

  const clean = [];
  for (const entry of entries) {
    const itemId = Number(entry.itemId);
    const studentId = Number(entry.studentId);
    const item = items.get(itemId);
    if (!item) return res.status(400).json({ error: `Item ${entry.itemId} is not part of this class record.` });
    if (!rosterIds.has(studentId)) return res.status(400).json({ error: `Student ${entry.studentId} is not currently in this class.` });
    if (finalizedIds.has(studentId)) {
      return res.status(409).json({ error: "A learner's grade for this term is already finalized, so their scores can no longer be changed." });
    }
    if (entry.rawScore === null || entry.rawScore === '') {
      clean.push({ itemId, studentId, rawScore: null });
      continue;
    }
    const raw = Number(entry.rawScore);
    const hps = Number(item.highest_possible_score);
    if (!Number.isFinite(raw) || raw < 0 || raw > hps) {
      return res.status(400).json({ error: `A score on "${item.title}" must be between 0 and ${hps}.` });
    }
    clean.push({ itemId, studentId, rawScore: Math.round(raw * 100) / 100 });
  }

  await assessmentModel.saveScores(clean, req.user.id);
  const record = await buildClassRecord(offering, period.id);
  res.json({ saved: clean.length, ...record });
}

// POST /api/class-record/submit  Body: { classOfferingId, gradingPeriodId }
// Recomputes every learner from the stored scores and submits each COMPLETE
// term grade into the approval chain, with its breakdown as a snapshot.
// Body may also carry `studentIds` to submit only some learners.
// Incomplete learners are skipped and named; finalized grades are left
// alone by gradeModel.upsertSubmittedGrades, exactly as before.
async function submitClassRecord(req, res) {
  const scope = await loadScope(req, res, req.body, { write: true });
  if (!scope) return;
  const { offering, period } = scope;
  const record = await buildClassRecord(offering, period.id);
  // Optional `studentIds`: submit only these learners (a teacher sending up
  // the rows they have finished). Omitted, the whole class is submitted.
  let learners = record.learners;
  if (Array.isArray(req.body.studentIds)) {
    const wanted = new Set(req.body.studentIds.map(Number));
    learners = learners.filter((l) => wanted.has(l.studentId));
  }

  const finalized = learners.filter((l) => l.grade?.status === 'finalized');
  const incomplete = learners.filter((l) => l.grade?.status !== 'finalized' && !l.computed.complete);
  const ready = learners.filter((l) => l.grade?.status !== 'finalized' && l.computed.complete);

  if (ready.length === 0) {
    return res.status(400).json({
      error: incomplete.length > 0
        ? 'No learner has a complete set of scores yet, so there is no grade to submit.'
        : 'Every grade for this class and term is already finalized.',
      incomplete: incomplete.map((l) => ({ studentId: l.studentId, name: `${l.lastName}, ${l.firstName}`, missing: l.computed.missing })),
    });
  }

  const saved = await gradeModel.upsertSubmittedGrades({
    classOfferingId: offering.id,
    gradingPeriodId: period.id,
    recordedBy: req.user.id,
    entries: ready.map((l) => ({
      studentId: l.studentId,
      gradeValue: l.computed.termGrade,
      computation: { ...l.computed, computedAt: new Date().toISOString(), source: 'DepEd Order No. 015, s. 2026, Annex D' },
    })),
  });

  res.status(201).json({
    submitted: saved.length,
    grades: saved,
    skippedIncomplete: incomplete.map((l) => ({ studentId: l.studentId, name: `${l.lastName}, ${l.firstName}`, missing: l.computed.missing })),
    skippedFinalized: finalized.map((l) => ({ studentId: l.studentId, name: `${l.lastName}, ${l.firstName}` })),
  });
}

module.exports = { getClassRecord, createItem, updateItem, deleteItem, saveScores, submitClassRecord, canRead };
