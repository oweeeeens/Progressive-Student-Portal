// The arithmetic behind My Attendance's "Where you stand" and "Your patterns"
// sections. Pure functions over data the page already has, so every figure a
// student sees can be checked against the register below it.
//
// One rule runs through all of it, the same one the risk formula uses
// (backend riskEngine.js): a day marked Present or Late counts as attended;
// Absent and Excused count against the rate.

const ATTENDED = new Set(['present', 'late'])
const MISSED = new Set(['absent', 'excused'])

// What it takes to reach — or keep — the required rate this term.
//
//   attended / total ≥ required
//
// Below it: attend the next n recorded days without missing, where
//   (attended + n) / (total + n) ≥ r   →   n ≥ (r·total − attended) / (1 − r)
// At or above it: how many more absences still keep the rate up, where
//   attended / (total + k) ≥ r         →   k ≤ attended / r − total
//
// `weekdaysLeft` is the number of school weekdays left in the term (null when
// unknown). When recovery needs more days than the term has, the function
// says so instead of promising a number the student cannot reach.
export function rateOutlook({ attended, total, requiredPercent, weekdaysLeft = null }) {
  if (!total || requiredPercent == null) return null
  const r = requiredPercent / 100
  const rate = (attended / total) * 100
  if (rate >= requiredPercent) {
    // A tiny epsilon so 9/10 against 90% reads as exactly zero spare days,
    // not -0.0000001 rounded down to -1.
    const spare = Math.max(0, Math.floor(attended / r - total + 1e-9))
    return { status: 'meeting', rate, spare }
  }
  const needed = Math.ceil((r * total - attended) / (1 - r) - 1e-9)
  const reachable = weekdaysLeft == null || needed <= weekdaysLeft
  return { status: 'below', rate, needed, reachable, weekdaysLeft }
}

// Weekdays (Mon–Fri) from the day after `todayIso` up to and including
// `endIso`. The schema holds no holiday calendar, so these are weekdays, not
// school days — the page says "weekdays" for exactly that reason.
export function weekdaysRemaining(todayIso, endIso) {
  if (!todayIso || !endIso || endIso <= todayIso) return 0
  let count = 0
  const d = new Date(`${todayIso}T00:00:00Z`)
  const end = new Date(`${endIso}T00:00:00Z`)
  for (d.setUTCDate(d.getUTCDate() + 1); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) count += 1
  }
  return count
}

// How many recorded school days in a row, counting back from the most recent,
// the student attended (Present or Late).
export function currentStreak(records) {
  const sorted = [...(records || [])].sort((a, b) => (a.date < b.date ? 1 : -1))
  let streak = 0
  for (const r of sorted) {
    if (!ATTENDED.has(r.status)) break
    streak += 1
  }
  return streak
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

// Absences (absent + excused) and lates per weekday, Monday to Friday — and,
// when one weekday clearly stands out, a sentence saying so. "Clearly" means
// at least two of the student's absences, and more than on any other day: one
// absence on a Monday is not a pattern, and a tie is not a pattern either.
export function weekdayPattern(records) {
  const days = WEEKDAYS.map((name) => ({ name, short: name.slice(0, 3), missed: 0, late: 0 }))
  for (const r of records || []) {
    const wd = new Date(`${r.date}T00:00:00Z`).getUTCDay() // 0 Sun … 6 Sat
    if (wd < 1 || wd > 5) continue
    if (MISSED.has(r.status)) days[wd - 1].missed += 1
    else if (r.status === 'late') days[wd - 1].late += 1
  }
  const totalMissed = days.reduce((s, d) => s + d.missed, 0)
  const sorted = [...days].sort((a, b) => b.missed - a.missed)
  const top = sorted[0]
  const standsOut = top.missed >= 2 && top.missed > sorted[1].missed
  return {
    days,
    totalMissed,
    totalLate: days.reduce((s, d) => s + d.late, 0),
    highlight: standsOut ? { day: top.name, count: top.missed, of: totalMissed } : null,
  }
}
