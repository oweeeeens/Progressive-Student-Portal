// The five performance bands, as the UI renders them: their order, their
// names, their colours, and the ink that is readable printed inside each
// one's own fill.
//
// WHY THIS IS A SHARED FILE
//
// This lived inside AnalyticsPage.jsx, which was fine while Analytics was
// the only page drawing a band distribution. The home page now draws one
// too, for the signed-in person's own scope, and two copies of "which
// colour is At Risk - Medium" is exactly the kind of thing that drifts: the
// same learner would end up a different colour on two pages of the same
// product. The band COLOURS themselves are design tokens in index.css; this
// file is only the mapping from a band key to them.
//
// The key names match the server's own bucket keys
// (backend/services/analyticsCalculator.js BUCKET_KEYS), because every
// endpoint that reports bands reports them under these names.

// Fixed order, worst to best. Used everywhere a band is rendered - bars,
// legends, tables, toggles - and it matches the order the per-student
// Academic Progress Tracking page already sorts At Risk to the top by.
export const BUCKET_ORDER = [
  'at_risk_high',
  'at_risk_medium',
  'at_risk_low',
  'average',
  'performing_well',
  'not_yet_calculated',
]

export const BUCKET_LABELS = {
  at_risk_high: 'At Risk — High',
  at_risk_medium: 'At Risk — Medium',
  at_risk_low: 'At Risk — Low',
  average: 'Average / Steady',
  performing_well: 'Performing Well',
  not_yet_calculated: 'Not Yet Calculated',
}

// Every value here is an existing design token, never a literal. The three
// At Risk steps are ONE deepening red because risk level is ordinal, not
// categorical; Average is the system's single blue; Performing Well is the
// one genuinely good band and the only green. index.css carries the full
// reasoning, including why the traffic-light scheme this replaced was
// wrong and the colour-vision-deficiency figures that settled the greens.
// Not Yet Calculated is a neutral grey, since it is a data-coverage caveat
// rather than a band anybody is in.
export const BUCKET_COLORS = {
  at_risk_high: 'var(--band-at-risk-high)',
  at_risk_medium: 'var(--band-at-risk-medium)',
  at_risk_low: 'var(--band-at-risk-low)',
  average: 'var(--band-average)',
  performing_well: 'var(--band-performing-well)',
  not_yet_calculated: 'var(--risk-none)',
}

// Readable ink for a count printed INSIDE a segment of that fill - also
// band tokens, so light and dark mode each get the right one automatically.
export const BUCKET_LABEL_COLORS = {
  at_risk_high: 'var(--band-ink-on-at-risk-high)',
  at_risk_medium: 'var(--band-ink-on-at-risk-medium)',
  at_risk_low: 'var(--band-ink-on-at-risk-low)',
  average: 'var(--band-ink-on-average)',
  performing_well: 'var(--band-ink-on-performing-well)',
  not_yet_calculated: 'var(--color-text)',
}

export const toSegment = (key) => ({
  key,
  label: BUCKET_LABELS[key],
  color: BUCKET_COLORS[key],
  labelColor: BUCKET_LABEL_COLORS[key],
})

// Every bucket, including the not-yet-assessed caveat - needed by the
// breakdown table and the export, which report on the full roster.
export const SEGMENT_SPEC = BUCKET_ORDER.map(toSegment)

// The five REAL bands. "Not Yet Calculated" is a data-coverage caveat, not
// a performance band, and when a school is mid-grading-period it can be the
// largest slice on the chart - dominating a visualization that is supposed
// to be about how students are doing. Pages report it as a line of text
// beneath the chart instead.
export const BAND_SEGMENT_SPEC = BUCKET_ORDER.filter((key) => key !== 'not_yet_calculated').map(toSegment)

// The three BANDS, worst to best — a different (coarser) vocabulary from
// the bucket keys above, which split At Risk into its three levels. A band
// is what academicProgressCalculator.determineBand returns and what a
// student row carries as `band`; a bucket is how a distribution chart
// slices it.
//
// This is only an ORDERING, for deciding which WAY a learner moved between
// two terms and which movements matter most. The bands themselves, their
// labels and their colours are defined above and in the server's
// config/academicProgress.js.
export const BAND_RANK = { at_risk: 0, average: 1, performing_well: 2 }
