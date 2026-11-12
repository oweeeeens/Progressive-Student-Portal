// Computes one learner's term grade from their recorded scores, exactly the
// way DepEd Order No. 015, s. 2026 (Annex D) prescribes. Pure: no database,
// no request — it is handed the class record's items and this learner's
// scores and returns the full breakdown, so it can be tested on its own
// (scripts/testGradeCalculator.js) and explained line by line.
//
// THE FIVE STEPS (Annex D ¶2–5), with DepEd's own worked example from the
// order (Table 5, a Science learner):
//
//   Step 1  Total the raw scores per component.
//           WW: 17+22+20+15 = 74 of 85 · PT: 20+23 = 43 of 50
//   Step 2  Percentage Score  PS = total raw ÷ highest possible score × 100
//           WW: 74 ÷ 85 × 100 = 87.06 · PT: 43 ÷ 50 × 100 = 86.00
//           EX is built from its parts first (¶6): ST1 15/20 = 75.00 × 30% =
//           22.50, ST2 18/20 = 90.00 × 30% = 27.00, TE 35/40 = 87.50 × 40% =
//           35.00 → EX PS 84.50
//   Step 3  Weighted Score  WS = PS × component weight
//           WW 87.06 × 20% = 17.41 · PT 86.00 × 50% = 43.00 · EX 84.50 × 30% = 25.35
//   Step 4  Initial Grade  IG = sum of the WSs = 85.76
//   Step 5  Transmute (SY 2026–2027 table): 85.34–86.51 → Term Grade 88
//
// ROUNDING. Every PS and WS is rounded to two decimals before it is used in
// the next step — the precision DepEd's printed tables and e-Class Record
// show. That is deliberate: the breakdown the System displays then adds up
// exactly, so a teacher, a learner or a panelist can redo the arithmetic
// from the numbers on screen and arrive at the same grade.
//
// A MISSING SCORE IS NOT A ZERO. If a learner has no score for an item the
// grade is reported as incomplete, with the reason, and no term grade is
// produced. Treating a blank as 0 would silently fail a learner who was
// simply not yet encoded.
const {
  COMPONENTS,
  WEIGHT_GROUPS,
  DEFAULT_WEIGHT_GROUP,
  EXAM_PARTS,
  TERM_EXAM_ONLY_GROUPS,
  TRANSMUTATION_TABLE,
  MINIMUM_REPORTABLE_GRADE,
} = require('../config/gradingPolicy');

// Round half up to two decimals. The EPSILON nudge keeps 1.005 from
// becoming 1.00 through floating-point representation.
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Step 5 for SY 2026–2027: find the first band (highest first) whose
// minimum the Initial Grade reaches.
function transmute(initialGrade) {
  const ig = round2(initialGrade);
  for (const [minimum, transmuted] of TRANSMUTATION_TABLE) {
    if (ig >= minimum) return transmuted;
  }
  return MINIMUM_REPORTABLE_GRADE;
}

// The Term Grade from an Initial Grade under either rule. Zero-based
// (Annex D ¶15): no conversion, the IG rounded to a whole number, never
// reported below 60 (¶18).
function toTermGrade(initialGrade, mode) {
  if (mode === 'zero_based') {
    return Math.max(MINIMUM_REPORTABLE_GRADE, Math.round(round2(initialGrade)));
  }
  return transmute(initialGrade);
}

// Step 1 + 2 for one group of items (a component, or one exam part):
// total the raw scores and highest possible scores, then the percentage.
// Returns the items with each learner score, and which ones are blank.
function scoreItems(items, scoreFor) {
  let raw = 0;
  let hps = 0;
  const detail = [];
  const missing = [];
  for (const item of items) {
    const score = scoreFor(item.id);
    const highest = Number(item.highestPossibleScore);
    hps += highest;
    if (score === null || score === undefined || score === '') {
      missing.push(item.title);
      detail.push({ id: item.id, title: item.title, highestPossibleScore: highest, rawScore: null });
    } else {
      raw += Number(score);
      detail.push({ id: item.id, title: item.title, highestPossibleScore: highest, rawScore: Number(score) });
    }
  }
  return {
    rawScore: round2(raw),
    highestPossibleScore: round2(hps),
    percentageScore: hps > 0 && missing.length === 0 ? round2((raw / hps) * 100) : null,
    items: detail,
    missing,
  };
}

// The whole computation for one learner in one class and term.
//
//   items      [{ id, component: 'ww'|'pt'|'ex', examPart: 'st1'|'st2'|'te'|null,
//                 title, highestPossibleScore }]
//   scores     a Map (or object) of itemId -> raw score, for THIS learner
//   weightGroup a key of WEIGHT_GROUPS (the subject's group)
//   mode       'transmuted' | 'zero_based'
//
// Returns { weightGroup, mode, components: [...], initialGrade, termGrade,
// complete, missing }. When `complete` is false, initialGrade and termGrade
// are null and `missing` says why, in words a teacher can act on.
function computeTermGrade({ items, scores, weightGroup = DEFAULT_WEIGHT_GROUP, mode = 'transmuted' }) {
  const weights = WEIGHT_GROUPS[weightGroup] || WEIGHT_GROUPS[DEFAULT_WEIGHT_GROUP];
  const scoreFor = (itemId) => (scores instanceof Map ? scores.get(itemId) : scores?.[itemId]);
  const missing = [];
  const components = [];

  for (const key of Object.keys(COMPONENTS)) {
    const weight = weights[key];
    // A component the group does not have (Research and Work Immersion have
    // no Examinations) is skipped entirely, not counted as zero.
    if (weight === null || weight === undefined) continue;

    const componentItems = items.filter((item) => item.component === key);
    const entry = {
      key,
      label: COMPONENTS[key].label,
      weight,
      rawScore: null,
      highestPossibleScore: null,
      percentageScore: null,
      weightedScore: null,
      items: [],
      parts: null,
    };

    if (key !== 'ex') {
      if (componentItems.length === 0) {
        missing.push(`No ${COMPONENTS[key].label} recorded yet`);
      } else {
        const scored = scoreItems(componentItems, scoreFor);
        Object.assign(entry, {
          rawScore: scored.rawScore,
          highestPossibleScore: scored.highestPossibleScore,
          percentageScore: scored.percentageScore,
          items: scored.items,
        });
        for (const title of scored.missing) missing.push(`No score for ${title}`);
      }
    } else {
      // Examinations: each part becomes its own percentage, is weighted
      // inside the component (30/30/40), and the weighted parts add up to
      // the EX percentage. Field Exposure groups have a Term Exam only,
      // carrying the whole EX weight (Annex D ¶7).
      const partKeys = TERM_EXAM_ONLY_GROUPS.has(weightGroup) ? ['te'] : Object.keys(EXAM_PARTS);
      const parts = [];
      let examPercentage = 0;
      let examComplete = true;
      for (const part of partKeys) {
        const partWeight = partKeys.length === 1 ? 1 : EXAM_PARTS[part].weight;
        const partItems = componentItems.filter((item) => item.examPart === part);
        const partEntry = {
          key: part,
          label: EXAM_PARTS[part].label,
          weight: partWeight,
          rawScore: null,
          highestPossibleScore: null,
          percentageScore: null,
          weightedScore: null,
          items: [],
        };
        if (partItems.length === 0) {
          examComplete = false;
          missing.push(`No ${EXAM_PARTS[part].label} recorded yet`);
        } else {
          const scored = scoreItems(partItems, scoreFor);
          Object.assign(partEntry, {
            rawScore: scored.rawScore,
            highestPossibleScore: scored.highestPossibleScore,
            percentageScore: scored.percentageScore,
            items: scored.items,
          });
          if (scored.missing.length > 0) {
            examComplete = false;
            for (const title of scored.missing) missing.push(`No score for ${title}`);
          } else {
            partEntry.weightedScore = round2(scored.percentageScore * partWeight);
            examPercentage += partEntry.weightedScore;
          }
        }
        parts.push(partEntry);
      }
      entry.parts = parts;
      entry.items = parts.flatMap((p) => p.items);
      if (examComplete) entry.percentageScore = round2(examPercentage);
    }

    // Step 3: WS = PS × weight, only once the PS exists.
    if (entry.percentageScore !== null) {
      entry.weightedScore = round2(entry.percentageScore * weight);
    }
    components.push(entry);
  }

  const complete = missing.length === 0;
  // Step 4: the Initial Grade is the sum of the (already rounded) WSs.
  const initialGrade = complete ? round2(components.reduce((sum, c) => sum + c.weightedScore, 0)) : null;
  // Step 5.
  const termGrade = complete ? toTermGrade(initialGrade, mode) : null;

  return { weightGroup, mode, components, initialGrade, termGrade, complete, missing };
}

module.exports = { computeTermGrade, transmute, toTermGrade, round2 };
