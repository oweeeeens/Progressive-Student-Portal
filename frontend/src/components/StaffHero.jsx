import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useDrawIn } from '../hooks/useDrawIn'

// The staff counterpart to StudentHero: who is signed in, what they are
// responsible for, and where the school year has got to.
//
// This replaces a plain "Welcome, Test" heading plus a three-field "Your
// account" card that sat in the right column leaving most of it empty. The
// identity belongs at the top of the page, not in a box beside it.
//
// It carries the TERM as well now, because every other figure on this page
// is relative to it: "4 grades to finalize" and "6 learners flagged" both
// mean something different in the first week of a term than in the last.
// Having to work out which term it is, and how much of it is left, was a
// question the page quietly left to the reader.

function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const ROLE_LABELS = {
  admin: 'Administrator',
  principal: 'Principal',
  registrar: 'Registrar',
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  ict_faculty: 'ICT Faculty',
}

// A grading period's dates arrive as plain 'YYYY-MM-DD' strings (the server
// returns DATE columns unparsed on purpose — see backend/config/db.js for
// the timezone bug that forced it). Appending T00:00:00 keeps them being
// read as LOCAL midnight; without it the browser reads them as UTC and, at
// the school's UTC+8, every date names the day before.
function asLocalDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`)
}

// How many weekdays remain in the term, counting today.
//
// Deliberately "weekdays" and not "school days": this schema holds no
// holiday calendar, so a public holiday cannot be excluded, and calling
// these school days would be a claim the data does not support. Counted by
// walking the days rather than with arithmetic on the week count, because
// the start and end can fall on any weekday and the off-by-one cases are
// exactly where a term-progress figure loses trust.
function weekdaysRemaining(today, endDate) {
  let count = 0
  const cursor = new Date(today)
  const end = asLocalDate(endDate)
  while (cursor <= end) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) count += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}

// How far through the term today is, 0-100, on the CALENDAR (not weekdays):
// the bar represents elapsed time, and a reader comparing it against a
// wall calendar should not find it disagreeing.
function termProgressPercent(today, startDate, endDate) {
  const start = asLocalDate(startDate).getTime()
  const end = asLocalDate(endDate).getTime()
  if (!(end > start)) return null
  const fraction = (today.getTime() - start) / (end - start)
  return Math.round(Math.min(Math.max(fraction, 0), 1) * 100)
}

// The term block on the right of the hero. Returns null rather than an
// empty frame when there is no current period — between terms the
// honest answer is a sentence, which the caller renders instead.
//
// `today` is passed in rather than read here: the parent already needs it
// for the date in the greeting, and one clock reading per render is also
// what keeps the progress bar and the date underneath it from disagreeing
// across a midnight re-render.
function TermStanding({ currentPeriod, today }) {
  // The bar fills in from empty on first paint, and is simply drawn at its
  // value for a reader who has asked for reduced motion — see useDrawIn,
  // which the charts already use for exactly this.
  const drawn = useDrawIn()

  if (!currentPeriod?.startDate || !currentPeriod?.endDate) return null

  const percent = termProgressPercent(today, currentPeriod.startDate, currentPeriod.endDate)
  if (percent == null) return null
  const remaining = weekdaysRemaining(today, currentPeriod.endDate)

  return (
    <div className="portal-hero__term">
      <p className="portal-hero__term-label">
        {currentPeriod.name}
        {currentPeriod.schoolYearLabel && <span> · {currentPeriod.schoolYearLabel}</span>}
      </p>
      {/* A meter, not a decorative bar: it reports a value, and says that
          value in text underneath so the bar is never the only source of
          it. */}
      <div
        className="portal-hero__term-track"
        role="meter"
        aria-label="Progress through the grading period"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% through ${currentPeriod.name}`}
      >
        <div
          className="portal-hero__term-fill"
          style={{ clipPath: `inset(0 ${drawn ? 100 - percent : 100}% 0 0 round 999px)` }}
        />
      </div>
      <p className="portal-hero__term-meta">
        {percent}% through ·{' '}
        {remaining === 0 ? 'last day' : `${remaining} ${remaining === 1 ? 'weekday' : 'weekdays'} left`}
      </p>
    </div>
  )
}

export function StaffHero({ user, currentPeriod }) {
  // What this person is actually responsible for. An adviser's sections and
  // a subject teacher's classes come from the same endpoints the rest of the
  // app already uses — this adds no new server surface, and it is the one
  // fact that makes the greeting specific to them rather than generic.
  const [assignment, setAssignment] = useState(null)

  // BOTH endpoints, for everyone — not one branch per role label.
  //
  // This used to read `if (role === 'adviser') … else if (role ===
  // 'subject_teacher') …`, so a teacher who advises one section and teaches
  // subjects to others saw only the half that matched their role column. In
  // this school that is the ordinary case, not an edge case, and the whole
  // point of the greeting is to name what this person is actually
  // responsible for today.
  //
  // Students are skipped: they hold neither assignment, so the two requests
  // could only ever come back empty.
  useEffect(() => {
    if (user.role === 'student') return undefined

    let cancelled = false
    Promise.all([
      api.get('/sections/mine').catch(() => null),
      api.get('/class-offerings/mine').catch(() => null),
    ]).then(([sec, off]) => {
      if (cancelled) return
      const sections = sec?.sections || []
      const offerings = off?.classOfferings || []

      // Advised sections are named; taught classes are counted. A name is
      // what an adviser recognises their register by, while a teacher with
      // five classes across three sections would turn this line into a
      // paragraph — the profile page lists them individually instead.
      const parts = []
      if (sections.length) parts.push(sections.map((s) => s.name).join(' · '))
      if (offerings.length) parts.push(`${offerings.length} class${offerings.length === 1 ? '' : 'es'}`)
      setAssignment(parts.join(' · ') || null)
    })

    return () => {
      cancelled = true
    }
  }, [user.role])

  const now = new Date()
  const today = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const term = <TermStanding currentPeriod={currentPeriod} today={now} />

  return (
    <section className="portal-hero portal-hero--staff">
      <div className="portal-hero__body">
        <p className="portal-hero__greeting">{greeting()}</p>
        <h1 className="portal-hero__name">{user.fullName.split(' ')[0]}</h1>
        <p className="portal-hero__meta">
          {[ROLE_LABELS[user.role] || user.role, assignment, today].filter(Boolean).join('  ·  ')}
        </p>
      </div>

      {/* Between terms there is no progress to draw, and a missing block
          would read as a layout fault. The sentence is the information. */}
      {term || (
        <div className="portal-hero__term portal-hero__term--none">
          <p className="portal-hero__term-label">Between grading periods</p>
          <p className="portal-hero__term-meta">
            Today falls outside every configured term, so figures tied to a grading period are not shown.
          </p>
        </div>
      )}
    </section>
  )
}
