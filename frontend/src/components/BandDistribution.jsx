import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { BarChart } from './charts/BarChart'
import { ChartCard } from './charts/ChartCard'
import { SkeletonChart } from './Skeleton'
import { BAND_SEGMENT_SPEC } from '../utils/performanceBands'
import { describeLargestShare, describeFlaggedChange } from '../utils/chartInterpretation'

// How the signed-in person's own learners are standing — the home page's
// one chart.
//
// WHY THIS IS ON THE HOME PAGE AT ALL
//
// The product's innovation is trend-based risk detection, and the staff
// landing page contained no data visualisation whatsoever: the one block
// about learners at all was a 300px column of small text in a sidebar. This
// puts the band distribution for THIS PERSON'S SCOPE where they land.
//
// WHY ONE PERIOD AND NOT A TREND
//
// Analytics already owns the over-time view, with filters and five tabs. A
// dashboard answers "where are we now"; the movement since last term is
// stated as a sentence underneath instead (describeFlaggedChange), which on
// a landing page is both shorter and clearer than three small-multiple
// charts squeezed into a column.
//
// WHY A BAR PER BAND AND NOT A STACKED BAR
//
// BarChart's own header states the rule and the reason: a stacked bar makes
// the reader measure each segment against a moving start point. Five bands
// against one shared zero is read in two seconds; five stacked segments is
// arithmetic. Every row is labelled, so a band is never identified by
// colour alone — which matters here more than anywhere, because this is the
// frozen, colour-vision-validated risk ramp.

// Roles that have Analytics in their navigation, and so can be sent there
// for the full picture. Advisers deliberately do not: they get the
// per-section Academic Progress view instead (CLAUDE.md), so their link
// goes there.
const ANALYTICS_ROLES = ['admin', 'principal', 'guidance_counselor']

export function BandDistribution({ bands, role }) {
  // Still loading. The shape of what is coming, not the word "Loading" —
  // the page knows exactly what will occupy this space.
  if (!bands) {
    return (
      <section className="standing-panel">
        <SkeletonChart />
      </section>
    )
  }

  const periods = bands.periods || []
  // Every period with at least one assessment, newest last. A school with
  // no finalized grades yet has none, and this block does not render at all
  // rather than drawing an empty chart with five zeroes in it.
  const current = periods.length > 0 ? periods[periods.length - 1] : null
  if (!current || current.total === 0) return null

  // One row per band, value = how many learners. The value cell carries the
  // count AND the share, so the chart needs no legend: each row says its own
  // name. maxValue is the period's own total, which is what makes "4 of 23"
  // and the bar length agree.
  const rows = BAND_SEGMENT_SPEC.map((segment) => ({
    key: segment.key,
    label: segment.label,
    value: current.counts[segment.key],
    color: segment.color,
    valueText: `${current.counts[segment.key]} (${Math.round((current.counts[segment.key] / current.total) * 1000) / 10}%)`,
  }))

  const deepLink = ANALYTICS_ROLES.includes(role)
    ? { to: '/analytics', label: 'Open Analytics' }
    : { to: '/academic-progress', label: 'Open Academic Progress' }

  return (
    <section className="standing-panel">
      <ChartCard
        title="Where your learners stand"
        description={`Every learner in your scope with a risk assessment for ${current.periodName}, grouped into the three performance bands.`}
        interpretation={describeLargestShare(rows, { total: current.total, itemNoun: 'assessed learners' })}
        actions={
          <Link to={deepLink.to} className="standing-panel__link">
            {deepLink.label}
            <ArrowUpRight size={14} strokeWidth={2} />
          </Link>
        }
      >
        <BarChart rows={rows} maxValue={current.total} />
      </ChartCard>

      {/* The movement the chart itself does not show. Rendered outside
          ChartCard's own interpretation line because that one describes the
          picture above it, and this one describes what the picture is
          compared with — two different claims, and collapsing them into one
          sentence made both harder to check. */}
      {periods.length > 1 && <p className="standing-panel__change">{describeFlaggedChange(periods)}</p>}
    </section>
  )
}
