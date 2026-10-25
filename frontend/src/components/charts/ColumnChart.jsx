import { useChartWidth } from '../../hooks/useChartWidth'
import { ChartTooltip, useChartTooltip } from './ChartTooltip'

// Vertical bars over time, measured against a threshold — the form for
// "was each grading period above or below the line the school requires?".
//
// Why this exists alongside LineChart and BarChart:
//   - LineChart answers "which direction is this going", and it can start
//     its axis part-way up (a slope is still a slope on a cropped axis).
//   - A BAR encodes its value by LENGTH, so its axis has to start at zero or
//     every comparison it invites is wrong — a 62 next to a 74 drawn from a
//     baseline of 60 looks like one fifth of the other. Hence yMin defaults
//     to 0 and callers are not expected to crop it.
//   - BarChart is horizontal and per-CATEGORY (subjects, sections). Periods
//     are a time axis and read left-to-right, which is why this one is
//     vertical rather than reusing that component.
//
// The threshold is drawn as a labelled reference line and ALSO decides each
// bar's colour, so "below the line" is legible two ways: by position against
// the line and by hue. The colour pair is the app's existing blue/deep-red
// pairing (--chart-blue vs --band-at-risk-high, the same two already used by
// the Lowest-Attendance Sections chart); under the dataviz validator the
// pair clears CVD separation at deltaE 27 and contrast against the surface,
// and colour never carries the meaning alone here — the reference line, the
// legend and the printed value all repeat it.
//
// `points`: [{ label, value }] — ONE ENTRY PER PERIOD THAT EXISTS. A null
// value is MISSING, not zero (a period with no finalized grades yet), and
// draws no bar at all: a zero-height bar in a 0-100 chart reads as "scored
// nothing", which is a different and much worse claim than "not recorded".
// `reference`: { value, label, shortLabel } or null for no threshold line.
const HEIGHT = 190
// The right gutter holds the reference line's label. Keeping the label
// OUTSIDE the plot is what makes it impossible for it to land on top of a
// bar or a value label, whatever the data does.
const PADDING = { top: 28, right: 100, bottom: 26, left: 44 }
// A bar wider than this stops reading as a mark and starts reading as a
// block of colour; with three periods in a wide card that happens quickly.
const MAX_BAR_WIDTH = 56
// ...and bars don't spread to fill an arbitrarily wide card either. Past
// this much room per period, two bars end up at opposite ends of the plot
// and comparing them means scanning across empty space, which is the one
// thing this chart exists to make easy. The group is centred instead, while
// the gridlines and the threshold line still span the full plot.
const MAX_SLOT_WIDTH = 180
const BAR_SLOT_FILL = 0.6
const BAR_CORNER_RADIUS = 4
// A gridline this close to the reference line is the same line twice: the
// solid tick is dropped and the dashed threshold kept.
const GRIDLINE_COLLISION_PX = 2
// A real but tiny value still gets a visible stub rather than nothing, so a
// 1% period is distinguishable from a period with no data at all.
const MIN_VISIBLE_BAR_HEIGHT = 2

export function ColumnChart({
  points,
  yMin = 0,
  yMax = 100,
  formatValue = (v) => String(v),
  reference = null,
  aboveColor = 'var(--chart-blue)',
  belowColor = 'var(--band-at-risk-high)',
}) {
  const [widthRef, width] = useChartWidth(480)
  const { containerRef, tooltip, show, hide } = useChartTooltip()

  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom
  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 60)
  const baseY = PADDING.top + plotHeight
  const groupWidth = Math.min(plotWidth, MAX_SLOT_WIDTH * Math.max(points.length, 1))
  const groupLeft = PADDING.left + (plotWidth - groupWidth) / 2
  const slotWidth = groupWidth / Math.max(points.length, 1)
  const barWidth = Math.min(MAX_BAR_WIDTH, slotWidth * BAR_SLOT_FILL)

  function yFor(value) {
    const clamped = Math.max(yMin, Math.min(yMax, value))
    return PADDING.top + plotHeight - ((clamped - yMin) / (yMax - yMin)) * plotHeight
  }
  function slotLeft(index) {
    return groupLeft + slotWidth * index
  }
  function centerX(index) {
    return slotLeft(index) + slotWidth / 2
  }

  // A bar is a path rather than a <rect rx>, because rx rounds all four
  // corners: the dataviz spec wants the data END rounded and the baseline
  // end square, so the bar stays visibly anchored to zero.
  function barPath(x, top, w, h) {
    const r = Math.min(BAR_CORNER_RADIUS, w / 2, h)
    return [
      `M ${x} ${top + h}`,
      `L ${x} ${top + r}`,
      `Q ${x} ${top} ${x + r} ${top}`,
      `L ${x + w - r} ${top}`,
      `Q ${x + w} ${top} ${x + w} ${top + r}`,
      `L ${x + w} ${top + h}`,
      'Z',
    ].join(' ')
  }

  function colorFor(value) {
    if (value == null) return 'var(--color-border-strong)'
    if (!reference) return aboveColor
    return value < reference.value ? belowColor : aboveColor
  }

  const referenceY = reference ? yFor(reference.value) : null
  const gridValues = [yMin, (yMin + yMax) / 2, yMax]

  // A bar whose value sits exactly on a gridline printed the same number
  // twice — once as the axis tick on the left, once as the bar's own label —
  // with the gridline running between them joining the two into what looks
  // like one duplicated reading. The axis tick is the recessive of the two,
  // so it yields; the gridline itself still draws, and the scale is still
  // anchored by the ticks that remain.
  const drawnValueLabels = points.filter((p) => p.value != null).map((p) => formatValue(p.value))
  function axisLabelIsDuplicated(gridValue) {
    return drawnValueLabels.includes(formatValue(gridValue))
  }
  // The threshold line and a gridline at the same height are one line drawn
  // twice; the dashed threshold is the one worth keeping.
  function gridlineIsUnderReference(gridValue) {
    return referenceY != null && Math.abs(yFor(gridValue) - referenceY) < GRIDLINE_COLLISION_PX
  }

  const activeIndex = tooltip?.index ?? null

  function tooltipFor(index) {
    const point = points[index]
    const standing =
      reference && point.value != null
        ? point.value < reference.value
          ? `Below ${reference.label}`
          : `At or above ${reference.label}`
        : null
    return {
      key: `col-${index}`,
      index,
      title: point.label,
      rows: [
        { label: '', value: point.value == null ? 'No data' : formatValue(point.value), color: colorFor(point.value) },
        ...(standing ? [{ label: standing, value: '' }] : []),
      ],
    }
  }

  return (
    <div className="chart-frame" ref={containerRef}>
      <div ref={widthRef}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Bar chart by grading period">
          {gridValues.map((gridValue) => (
            <g key={gridValue}>
              {!gridlineIsUnderReference(gridValue) && (
                <line
                  x1={PADDING.left}
                  x2={PADDING.left + plotWidth}
                  y1={yFor(gridValue)}
                  y2={yFor(gridValue)}
                  className="chart-gridline"
                />
              )}
              {!axisLabelIsDuplicated(gridValue) && (
                <text
                  x={PADDING.left - 8}
                  y={yFor(gridValue)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="chart-axis-label"
                >
                  {formatValue(gridValue)}
                </text>
              )}
            </g>
          ))}

          {/* The threshold. Dashed so it never reads as a data mark, and
              labelled in the right gutter so it can't overlap a bar. */}
          {reference && (
            <g>
              <line
                x1={PADDING.left}
                x2={PADDING.left + plotWidth}
                y1={referenceY}
                y2={referenceY}
                className="chart-reference-line"
              />
              <text
                x={PADDING.left + plotWidth + 8}
                y={referenceY}
                dominantBaseline="middle"
                className="chart-reference-label"
              >
                {reference.shortLabel || reference.label}
              </text>
            </g>
          )}

          {points.map((point, index) => {
            const isMissing = point.value == null
            const top = isMissing ? baseY : yFor(point.value)
            const height = isMissing ? 0 : Math.max(baseY - top, point.value > yMin ? MIN_VISIBLE_BAR_HEIGHT : 0)
            const x = slotLeft(index) + (slotWidth - barWidth) / 2

            return (
              <g key={point.label}>
                {isMissing ? (
                  // No bar, just a muted stub on the baseline plus an em dash
                  // where the value would have been: visibly "nothing
                  // recorded" rather than a bar of length zero.
                  <>
                    <line
                      x1={x}
                      x2={x + barWidth}
                      y1={baseY}
                      y2={baseY}
                      className="column-chart__missing"
                    />
                    <text x={centerX(index)} y={baseY - 8} textAnchor="middle" className="chart-axis-label">
                      —
                    </text>
                  </>
                ) : (
                  <>
                    <path
                      d={barPath(x, baseY - height, barWidth, height)}
                      fill={colorFor(point.value)}
                      className={`column-chart__bar${activeIndex === index ? ' is-hovered' : ''}`}
                    />
                    <text x={centerX(index)} y={baseY - height - 7} textAnchor="middle" className="chart-value-label">
                      {formatValue(point.value)}
                    </text>
                  </>
                )}
                <text
                  x={centerX(index)}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  className={`chart-row-label${activeIndex === index ? ' is-active' : ''}`}
                >
                  {point.label}
                </text>
              </g>
            )
          })}

          {/* Transparent full-height hit slabs, one per period, drawn last so
              they sit above the bars and catch the pointer anywhere in the
              column — including above a short bar, which is where a reader
              aiming at a low value naturally lands. */}
          {points.map((point, index) => (
            <rect
              key={`hit-${point.label}`}
              x={slotLeft(index)}
              y={PADDING.top}
              width={slotWidth}
              height={plotHeight}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${point.value == null ? 'no data' : formatValue(point.value)}${
                reference && point.value != null
                  ? point.value < reference.value
                    ? `, below ${reference.label}`
                    : `, at or above ${reference.label}`
                  : ''
              }`}
              onPointerMove={(e) => show(e, tooltipFor(index))}
              onPointerLeave={hide}
              onFocus={(e) => show(e, tooltipFor(index))}
              onBlur={hide}
            />
          ))}
        </svg>
      </div>

      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}
