// Display formatting for the numbers the API returns.
//
// Postgres NUMERIC columns arrive as strings carrying their full declared
// scale — an average of 81.8 comes over the wire as "81.80", a rate of 90%
// as "90.00", and a trend computed in the risk engine as "5.115". Rendered
// straight into a table that is otherwise carefully typeset, those trailing
// zeros and that fourth significant figure are the loudest thing on the
// page: they say the screen is showing the database rather than reporting a
// result. A grade is recorded to one decimal place; nothing is measured
// finely enough to justify three.
//
// These only change what is DISPLAYED. Nothing stored, compared or scored
// is rounded — the risk engine keeps working from the full values.

// Drops a trailing ".0" so a whole number reads as one: 91, not 91.0.
function trimTrailingZero(text) {
  return text.replace(/\.0$/, '')
}

// Returns null for anything that isn't a finite number, so callers can fall
// back to their own empty-value treatment (DataTable's EMPTY_VALUE) rather
// than printing "NaN".
function toNumber(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// A mark or an average: one decimal place at most. 91.00 -> 91, 81.80 -> 81.8
export function formatGrade(value) {
  const parsed = toNumber(value)
  if (parsed == null) return null
  return trimTrailingZero(parsed.toFixed(1))
}

// An attendance rate, with its sign of being a percentage. 90.00 -> 90%
export function formatRate(value) {
  const parsed = toNumber(value)
  if (parsed == null) return null
  return `${trimTrailingZero(parsed.toFixed(1))}%`
}

// A per-period rate of change. Always signed, because the direction is the
// whole point of a trend: +5.1, -6, 0. A flat trend reads as "0", not "+0".
export function formatTrend(value) {
  const parsed = toNumber(value)
  if (parsed == null) return null
  const rounded = trimTrailingZero(Math.abs(parsed).toFixed(1))
  if (parsed > 0) return `+${rounded}`
  if (parsed < 0) return `-${rounded}`
  return '0'
}
