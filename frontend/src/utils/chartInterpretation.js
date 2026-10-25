// Plain-language one-liners that sit under every chart saying what it
// MEANS, not what its axes are. Centralised so "dropped 12 points since Q1"
// is phrased identically wherever it appears, and so the wording can be
// corrected in one place rather than in every page that happens to plot a
// trend.
//
// Every function here is pure and takes the SAME points array the chart was
// given, so the sentence and the picture can never describe different data.

function firstAndLastReal(points) {
  const real = points.filter((p) => p.value != null)
  if (real.length < 2) return null
  return { first: real[0], last: real[real.length - 1] }
}

function roundTo1(n) {
  return Math.round(n * 10) / 10
}

// "Your average dropped 12 points since Q1." / "...held steady at 88 since Q1."
// `unit`: '' for plain points, '%' for rates.
export function describeTrend(points, { subject = 'It', unit = '', noun = 'points' } = {}) {
  const ends = firstAndLastReal(points)
  if (!ends) {
    const only = points.filter((p) => p.value != null)
    if (only.length === 1) return `${subject} is ${only[0].value}${unit} in ${only[0].label}. One period isn't a trend yet.`
    return null
  }
  const { first, last } = ends
  const delta = roundTo1(last.value - first.value)
  const magnitude = Math.abs(delta)
  if (magnitude === 0) {
    return `${subject} held steady at ${last.value}${unit} from ${first.label} to ${last.label}.`
  }
  const direction = delta > 0 ? 'rose' : 'dropped'
  return `${subject} ${direction} ${magnitude} ${noun} since ${first.label}, from ${first.value}${unit} to ${last.value}${unit}.`
}

// The recommendation line under a trend chart that has a threshold drawn on
// it: what changed between the first and last period, AND where the latest
// figure stands against the line the school requires. Both halves come from
// the same points array and the same threshold the chart plotted, so the
// sentence can never contradict the picture above it.
//
// "Your average dropped 12 points from Q1 to Q2, and at 62 it is 13 points
//  below the passing grade of 75."
// `thresholdLabel` names the threshold in words ("the passing grade of 75"),
// so the one place that phrasing is written down is the page that knows what
// the number means.
export function describeTrendAgainstThreshold(
  points,
  { subject = 'It', unit = '', noun = 'points', threshold, thresholdLabel = 'the threshold' } = {}
) {
  // Without a threshold there is nothing to stand against, so this degrades
  // to the plain trend sentence rather than inventing a comparison.
  if (threshold == null) return describeTrend(points, { subject, unit, noun })

  const real = points.filter((p) => p.value != null)
  if (real.length === 0) return null
  const last = real[real.length - 1]
  const gap = roundTo1(Math.abs(last.value - threshold))
  // "13 points below the passing grade of 75" / "17 points clear of ..." —
  // "clear of" rather than "above" because a reader skimming for the word
  // "below" shouldn't have to read two near-identical sentences carefully to
  // tell good news from bad.
  const standing =
    last.value === threshold
      ? `sits exactly at ${thresholdLabel}`
      : last.value < threshold
        ? `is ${gap} ${noun} below ${thresholdLabel}`
        : `is ${gap} ${noun} clear of ${thresholdLabel}`

  if (real.length === 1) {
    return `${subject} is ${last.value}${unit} in ${last.label}, which ${standing}. One period isn't a trend yet.`
  }

  const first = real[0]
  const delta = roundTo1(last.value - first.value)
  if (delta === 0) {
    return `${subject} held steady at ${last.value}${unit} from ${first.label} to ${last.label}, which ${standing}.`
  }
  const direction = delta > 0 ? 'rose' : 'dropped'
  return `${subject} ${direction} ${Math.abs(delta)} ${noun} from ${first.label} to ${last.label}, and at ${last.value}${unit} it ${standing}.`
}

// "3 of your 5 subjects are below the passing grade of 75."
export function describeBelowThreshold(rows, { threshold, unit = '', itemNoun = 'subjects' } = {}) {
  if (!rows || rows.length === 0) return null
  const below = rows.filter((r) => r.value < threshold)
  if (below.length === 0) {
    return `All ${rows.length} ${itemNoun} are at or above ${threshold}${unit}.`
  }
  const lowest = below.reduce((min, r) => (r.value < min.value ? r : min), below[0])
  // "1 of your 1 subjects is below 75" is technically true and reads badly.
  // Phrase the all-of-them and only-one cases as sentences a person would
  // actually say.
  if (rows.length === 1) {
    return `Your only ${itemNoun.replace(/s$/, '')}, ${lowest.label}, is below ${threshold}${unit} at ${lowest.value}${unit}.`
  }
  if (below.length === rows.length) {
    return `All ${rows.length} of your ${itemNoun} are below ${threshold}${unit} — lowest is ${lowest.label} at ${lowest.value}${unit}.`
  }
  return `${below.length} of your ${rows.length} ${itemNoun} ${below.length === 1 ? 'is' : 'are'} below ${threshold}${unit} — lowest is ${lowest.label} at ${lowest.value}${unit}.`
}

// "Most students are in the At Risk — Medium band (2 of 6 assessed)."
export function describeLargestShare(rows, { total, itemNoun = 'students' } = {}) {
  const withValues = (rows || []).filter((r) => r.value > 0)
  if (withValues.length === 0 || !total) return null
  const biggest = withValues.reduce((max, r) => (r.value > max.value ? r : max), withValues[0])
  const share = Math.round((biggest.value / total) * 1000) / 10
  return `Largest group is ${biggest.label} — ${biggest.value} of ${total} ${itemNoun} (${share}%).`
}

// "At-risk students attend 35 points less than everyone else this period."
export function describeGap(seriesA, seriesB, { labelA, labelB, unit = '%' } = {}) {
  const lastA = [...(seriesA || [])].reverse().find((p) => p.value != null)
  const lastB = [...(seriesB || [])].reverse().find((p) => p.value != null)
  if (!lastA || !lastB) return null
  const gap = roundTo1(Math.abs(lastA.value - lastB.value))
  if (gap === 0) return `${labelA} and ${labelB} are level at ${lastA.value}${unit} in ${lastA.label}.`
  const lower = lastA.value < lastB.value ? labelA : labelB
  return `${lower} is ${gap} ${unit === '%' ? 'points' : 'lower'} behind in ${lastA.label} (${lastA.value}${unit} vs ${lastB.value}${unit}).`
}
