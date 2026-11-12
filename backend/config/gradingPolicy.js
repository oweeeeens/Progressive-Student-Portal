// DepEd's grade-computation rules, in one place.
//
// SOURCE: DepEd Order No. 015, s. 2026 — "Revised Guidelines on Classroom
// Assessment, Grading System, and Awards and Recognition for the K to 12
// Basic Education Program" (signed 4 June 2026), Annex D "Guidelines on
// Numeric Grading System for Key Stage 2 to 4", pp. 35–39. Every number
// below was read off the signed order itself (the scanned PDF at
// deped.gov.ph/wp-content/uploads/DO_s2026_015r.pdf), not a summary of it.
// Senior High is Key Stage 4.
//
// WHY A CONFIG FILE. The same reason riskConfig.js exists: these are policy,
// not logic. DepEd revises them (DO 8, s. 2015 had different weights; SY
// 2027–2028 changes the transmutation rule for lower grades), and a panelist
// should be able to point at one file and see every figure the System grades
// by. services/gradeCalculator.js reads these and contains no numbers of its
// own.

// --- 1. Components ---------------------------------------------------------
//
// Annex D ¶2: a term grade is computed from three kinds of summative
// assessment. Formative work (daily checks, the ESRU cycle in Annex A) is
// explicitly NOT used for grades, and neither attendance nor class
// participation is a component — participation can only count if the
// teacher records it as a Performance Task item.
const COMPONENTS = {
  ww: { label: 'Written/Oral Works', short: 'WW' },
  pt: { label: 'Product/Performance Tasks', short: 'PT' },
  ex: { label: 'Examinations', short: 'EX' },
};

// --- 2. Weights per subject group (Annex D, Table 2, Grades 11 to 12) -------
//
// Each subject is assigned one of these groups (subjects.weight_group).
// `ex: null` means the group has no Examinations component at all — its
// weight is not "zero", the component does not exist, so a missing exam can
// never make such a grade incomplete.
const WEIGHT_GROUPS = {
  core: { label: 'Core subject', ww: 0.2, pt: 0.5, ex: 0.3 },
  academic_elective: { label: 'Academic elective', ww: 0.2, pt: 0.5, ex: 0.3 },
  arts_sports_wellness: { label: 'Arts, Sports, Health and Wellness elective', ww: 0.2, pt: 0.6, ex: 0.2 },
  field_exposure: {
    label: 'Field Exposure, Arts Apprenticeship, Creative Production and Innovation',
    ww: 0.15,
    pt: 0.7,
    ex: 0.15,
  },
  research_design: { label: 'Research, Design and Innovation', ww: 0.4, pt: 0.6, ex: null },
  techpro_elective: { label: 'TechPro elective', ww: 0.15, pt: 0.65, ex: 0.2 },
  work_immersion: { label: 'Work Immersion', ww: 0.2, pt: 0.8, ex: null },
};

const DEFAULT_WEIGHT_GROUP = 'core';

// --- 3. How the Examinations component is split (Annex D ¶6) -----------------
//
// EX = Summative Test 1 (30%) + Summative Test 2 (30%) + Term Examination
// (40%). Each part is turned into its own percentage first, weighted, and
// the weighted parts are added to give the EX percentage — Table 5 in the
// order shows exactly this ("WS ST1 (30%)", "WS ST2 (30%)", "WS TE (40%)").
const EXAM_PARTS = {
  st1: { label: 'Summative Test 1', weight: 0.3 },
  st2: { label: 'Summative Test 2', weight: 0.3 },
  te: { label: 'Term Examination', weight: 0.4 },
};

// Annex D ¶7: these groups' Examinations consist SOLELY of a Term
// Examination, which "shall carry the full 15% weight" — no summative tests.
const TERM_EXAM_ONLY_GROUPS = new Set(['field_exposure']);

// --- 4. Transmutation (Annex D ¶9–10, Table 4) -----------------------------
//
// The "Adjusted Transmutation Table (only for SY 2026–2027)". An Initial
// Grade of 70.00 now earns the passing 75; IGs below 70 map onto 60–74,
// "with 60 as the minimum reportable grade". Bands are [min, transmuted],
// highest first; an IG belongs to the first band whose minimum it reaches.
// The Initial Grade is compared at two decimals, the precision the table is
// printed in.
const TRANSMUTATION_TABLE = [
  [99.5, 100], [98.32, 99], [97.14, 98], [95.96, 97], [94.78, 96],
  [93.6, 95], [92.42, 94], [91.24, 93], [90.06, 92], [88.88, 91],
  [87.7, 90], [86.52, 89], [85.34, 88], [84.16, 87], [82.98, 86],
  [81.8, 85], [80.62, 84], [79.44, 83], [78.26, 82], [77.08, 81],
  [75.9, 80], [74.72, 79], [73.54, 78], [72.36, 77], [71.18, 76],
  [70.0, 75], [65.34, 74], [60.67, 73], [56.01, 72], [51.34, 71],
  [46.67, 70], [42.01, 69], [37.34, 68], [32.68, 67], [28.01, 66],
  [23.35, 65], [18.68, 64], [14.01, 63], [9.35, 62], [4.68, 61],
  [0, 60],
];

// 'transmuted' — SY 2026–2027, the table above.
// 'zero_based' — Annex D ¶13–15: no transmutation, the Initial Grade rounded
//   is the Term Grade, floored at 60 (¶18). The order schedules this for
//   SY 2027–2028 for Grades 4–10 (KS2–KS3); it names no date for Senior
//   High, so it stays a switch the school turns on when DepEd says so —
//   GRADING_MODE in the environment, no code change.
const GRADING_MODES = ['transmuted', 'zero_based'];

function readGradingMode() {
  const raw = process.env.GRADING_MODE;
  if (raw === undefined || raw === '') return 'transmuted';
  if (GRADING_MODES.includes(raw)) return raw;
  console.warn(`GRADING_MODE="${raw}" is not one of ${GRADING_MODES.join(', ')}; using "transmuted".`);
  return 'transmuted';
}

const GRADING_MODE = readGradingMode();

// --- 5. Reporting ----------------------------------------------------------
const MINIMUM_REPORTABLE_GRADE = 60; // Annex D ¶10b and ¶18
const PASSING_GRADE = 75; // the 75 every other part of the System uses

module.exports = {
  COMPONENTS,
  WEIGHT_GROUPS,
  DEFAULT_WEIGHT_GROUP,
  EXAM_PARTS,
  TERM_EXAM_ONLY_GROUPS,
  TRANSMUTATION_TABLE,
  GRADING_MODES,
  GRADING_MODE,
  MINIMUM_REPORTABLE_GRADE,
  PASSING_GRADE,
};
