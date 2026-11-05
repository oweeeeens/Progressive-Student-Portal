import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { BarChart } from './charts/BarChart'
import { ChartCard, ChartCardRow } from './charts/ChartCard'
import { SkeletonChart } from './Skeleton'
import { BAND_SEGMENT_SPEC } from '../utils/performanceBands'
import './BandTrend.css'

// How a cohort has MOVED across the school year's terms.
//
// WHY THIS EXISTS
//
// Academic Progress Tracking is the trend-based half of this product, and
// the page showed no trend at all: three tables, one grading period, a
// picker to change which period — and nothing that put two of them side by
// side. A reader could see that twelve learners are At Risk today and had
// no way to see whether that was fifteen last term or nine.
//
// TWO QUESTIONS, ANSWERED SEPARATELY
//
// The shape of the cohort each term is a chart. WHICH LEARNERS crossed a
// band is a list of names, because "three improved" is not actionable and
// "Carpio moved out of At Risk" is. They are different questions and they
// get different answers rather than one compromised visual.
//
// ONE CARD PER TERM, SHARING A SCALE — which is exactly what ChartCardRow
// documents itself as being for. Not a stacked bar: BarChart's own header
// records why ("a stacked bar makes the reader measure segments against a
// moving start point"), and five bands stacked three times over would be
// arithmetic rather than reading.

const MOVEMENT_ICON = { improved: ArrowUpRight, slipped: ArrowDownRight, same: Minus }

// `periods` is the server's band trend, oldest first:
//   [{ periodId, periodName, counts: { at_risk_high, ... }, total }]
// `movement` is { improved: [...], slipped: [...] } or null when there is
// no previous term to compare against.
export function BandTrend({ periods, movement, scopeLabel, loading }) {
  if (loading) {
    return (
      <section className="band-trend">
        <SkeletonChart />
      </section>
    )
  }

  const withData = (periods || []).filter((p) => p.total > 0)
  // Nothing to draw. A school in its first term, or a section with no
  // finalized grades yet, gets no chart rather than three empty frames.
  if (withData.length === 0) return null

  // One shared maximum across the terms, so the bars mean the same thing in
  // every card. Without it each term scales to its own largest band and two
  // cards that look identical describe different numbers.
  const sharedMax = Math.max(...withData.map((p) => p.total))

  return (
    <section className="band-trend" aria-labelledby="band-trend-heading">
      <div className="band-trend__head">
        <h2 id="band-trend-heading">How this {scopeLabel} has moved</h2>
      </div>

      <div className="band-trend__body">
        <ChartCardRow>
          {withData.map((period) => {
            const rows = BAND_SEGMENT_SPEC.map((segment) => ({
              key: segment.key,
              label: segment.label,
              value: period.counts[segment.key],
              color: segment.color,
              valueText: `${period.counts[segment.key]}`,
            }))
            return (
              <ChartCard
                key={period.periodId}
                title={period.periodName}
                description={`${period.total} assessed`}
              >
                <BarChart rows={rows} maxValue={sharedMax} />
              </ChartCard>
            )
          })}
        </ChartCardRow>

        {movement && <MovementList movement={movement} />}
      </div>
    </section>
  )
}

// Who crossed a band, by name. Deliberately NOT a count: the point of the
// closed loop is acting on a learner, and a number cannot be acted on.
function MovementList({ movement }) {
  const { improved, slipped, previousPeriodName } = movement
  const nothingMoved = improved.length === 0 && slipped.length === 0

  return (
    <aside className="band-trend__movement" aria-labelledby="band-movement-heading">
      <h3 id="band-movement-heading">Since {previousPeriodName}</h3>

      {nothingMoved ? (
        // A real answer. "Nobody changed band" is a finding about a cohort,
        // not an empty space, and it is one a school would want to know.
        <p className="band-trend__none">
          <Minus size={14} strokeWidth={2} aria-hidden="true" />
          No learner changed band since {previousPeriodName}.
        </p>
      ) : (
        <>
          <MovementGroup kind="improved" label="Improved" learners={improved} />
          <MovementGroup kind="slipped" label="Slipped" learners={slipped} />
        </>
      )}
    </aside>
  )
}

function MovementGroup({ kind, label, learners }) {
  if (learners.length === 0) return null
  const Icon = MOVEMENT_ICON[kind]

  return (
    <div className={`band-trend__group band-trend__group--${kind}`}>
      <p className="band-trend__group-head">
        <Icon size={14} strokeWidth={2.25} aria-hidden="true" />
        {label} ({learners.length})
      </p>
      <ul className="band-trend__list">
        {learners.map((learner) => (
          <li key={learner.studentId}>
            <span className="band-trend__name">
              {learner.lastName}, {learner.firstName}
            </span>
            {/* The direction is stated in words. The two band labels use the
                frozen ramp, and two shades of red are not a direction. */}
            <span className="band-trend__move">
              {learner.fromLabel} → {learner.toLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
