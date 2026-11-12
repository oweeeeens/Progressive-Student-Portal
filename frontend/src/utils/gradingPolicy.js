// Display labels for DepEd's grading groups, used where the page has no
// Class Record `policy` to read from (the Subjects form, a grade breakdown).
//
// Mirrors backend/config/gradingPolicy.js WEIGHT_GROUPS — same keys, same
// numbers. Source: DepEd Order No. 015, s. 2026, Annex D, Table 2 (Weight of
// the Components for Grade 11 to 12). `ex: null` means the group has no
// Examinations component at all.
export const WEIGHT_GROUPS = {
  core: { label: 'Core subject', ww: 0.2, pt: 0.5, ex: 0.3 },
  academic_elective: { label: 'Academic elective', ww: 0.2, pt: 0.5, ex: 0.3 },
  arts_sports_wellness: { label: 'Arts, Sports, Health and Wellness elective', ww: 0.2, pt: 0.6, ex: 0.2 },
  field_exposure: { label: 'Field Exposure, Arts Apprenticeship, Creative Production and Innovation', ww: 0.15, pt: 0.7, ex: 0.15 },
  research_design: { label: 'Research, Design and Innovation', ww: 0.4, pt: 0.6, ex: null },
  techpro_elective: { label: 'TechPro elective', ww: 0.15, pt: 0.65, ex: 0.2 },
  work_immersion: { label: 'Work Immersion', ww: 0.2, pt: 0.8, ex: null },
}

export const DEPED_SOURCE = 'DepEd Order No. 015, s. 2026, Annex D'

const pct = (fraction) => `${Math.round(fraction * 100)}%`

// "WW 20% · PT 50% · EX 30%" — the split, said in one line.
export function weightSplit(group) {
  const w = WEIGHT_GROUPS[group] || WEIGHT_GROUPS.core
  return [`WW ${pct(w.ww)}`, `PT ${pct(w.pt)}`, w.ex === null ? 'no exam' : `EX ${pct(w.ex)}`].join(' · ')
}
