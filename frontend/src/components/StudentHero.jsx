import { Award } from 'lucide-react'
import { StatusPill } from './StatusPill'

// The first thing a student sees when they open their portal.
//
// Before this, the page opened with the school's newest announcement, then a
// row of three context cards (which year, which period, am I enrolled), then
// an identity card printing their own LRN and guardian's phone number back
// at them — and only after all of that, below the fold, the thing they
// actually came for: how they are doing.
//
// This inverts it. The student's name, their standing and the one sentence
// that explains it come first; the school's noticeboard and their record on
// file move down the page, where reference material belongs.

// Time-of-day greeting. Deliberately not "Welcome back" — a greeting that
// could have been written for any product on any day is worse than none.
function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// What the band means, said plainly and without softening it. A student
// reading "At Risk" deserves to know it is about two numbers and that both
// can move, not to be told everything is fine.
const BAND_SUMMARY = {
  at_risk: 'Some of your marks and attendance need attention. Everything below explains exactly what and by how much.',
  average: 'You are on track. Nothing is flagged this grading period.',
  performing_well: 'You are doing well this grading period — keep it going.',
}

export function StudentHero({ student, progress, currentPeriod, riskLabels, riskVariants }) {
  const firstName = student.first_name || 'there'
  const section = [student.strand, student.section_name].filter(Boolean).join(' · ')
  const band = progress?.band
  // Performing Well is the one band a student can be pleased to see, and the
  // only place in the product where the school's gold is used to say "this
  // is yours". It is earned — the band requires no flagged factor AND either
  // an Outstanding average or a rising trend — so it is allowed to look it.
  const recognised = band === 'performing_well'

  return (
    <section className={`student-hero${recognised ? ' student-hero--recognised' : ''}`}>
      <div className="student-hero__body">
        <p className="student-hero__greeting">{greeting()}</p>
        <h1 className="student-hero__name">{firstName}</h1>

        <p className="student-hero__meta">
          {[section || 'No section assigned', currentPeriod?.name, currentPeriod?.schoolYearLabel]
            .filter(Boolean)
            .join('  ·  ')}
        </p>

        {progress && (
          <div className="student-hero__standing">
            {recognised && (
              <span className="student-hero__medal" aria-hidden="true">
                <Award size={20} strokeWidth={1.75} />
              </span>
            )}
            <StatusPill
              label={progress.riskLevel ? `${riskLabels[progress.riskLevel]} Risk` : progress.bandLabel}
              variant={
                progress.riskLevel
                  ? riskVariants[progress.riskLevel]
                  : band === 'performing_well'
                    ? 'positive'
                    : 'neutral'
              }
            />
            <p className="student-hero__summary">
              {(recognised && progress.note) || BAND_SUMMARY[band] || progress.bandLabel}
            </p>
          </div>
        )}

        {/* A student whose first grading period has not been finalised yet
            has no standing to show. Saying so is better than an empty space
            that looks like something failed to load — and it names what has
            to happen before the rest of this page fills in. */}
        {!progress && (
          <div className="student-hero__standing">
            <p className="student-hero__summary">
              Your standing appears here once your adviser enters this grading period&rsquo;s marks into the
              official record.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
