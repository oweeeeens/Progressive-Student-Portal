import { useChartWidth } from '../../hooks/useChartWidth'
import { lineChartLayout, CHART_NARROW } from './chartLayout'
import { useDrawIn } from '../../hooks/useDrawIn'
import { ChartTooltip, useChartTooltip } from './ChartTooltip'

// Line chart — the ONE form for anything over time. Up to 3 series; past
// that the lines stop being separable and the answer is small multiples
// (several of these, one per series) rather than a fourth line.
//
// Horizontal gridlines only, no vertical gridlines and no border around the
// plot: the cage adds ink without adding information, and the value labels
// already anchor the scale.
//
// A point whose value is null is MISSING, not zero — e.g. a cohort with no
// students that period. Plotting it as 0 invents a catastrophic number out
// of an absence of data, so a null breaks the line into a gap and draws no
// marker.
// Height and padding come from lineChartLayout(width), not a constant: the
// same chart is 241px wide in a small-multiple row on a desktop and 236px on
// a phone, and a gutter sized for a wide card eats both. See chartLayout.js.
// With only two or three periods, a full-bleed plot stretches a 2-point line
// edge to edge and turns a small change into a dramatic diagonal. Below this
// count the plot is capped and centred, so the slope reflects the data
// rather than the width of the card.
const SPARSE_POINT_THRESHOLD = 4
const SPARSE_MAX_SEGMENT_WIDTH = 150
// At or below this many points there's room to label every one; above it
// only the last is labelled.
const LABEL_ALL_THRESHOLD = 4
// A point whose value lands on a gridline printed its number twice within a
// few pixels — once as the axis tick, once as the data label — which read as
// a rendering fault. Past these distances the two are far enough apart to be
// legible as separate things; inside them the axis tick yields, since the
// data label is the number the reader came for.
const AXIS_LABEL_COLLISION_Y = 14
const AXIS_LABEL_COLLISION_X = 56

export function LineChart({
  points,
  series,
  color = 'var(--chart-blue)',
  formatValue = (v) => `${v}%`,
  yMin = 0,
  yMax = 100,
  axisNote = null,
}) {
  const [widthRef, width] = useChartWidth(480)
  const { containerRef, tooltip, markHandlers } = useChartTooltip()
  // The line draws along its own length on first paint (see .chart-line).
  const drawn = useDrawIn()

  const { height: chartHeight, padding, showMidGridline } = lineChartLayout(width)
  const plotHeight = chartHeight - padding.top - padding.bottom

  const seriesList = series && series.length > 0 ? series : [{ label: null, color, points }]
  const axisPoints = seriesList[0].points

  // Floored the way ColumnChart already floors its own: without this, a
  // card narrower than the two gutters combined produced a zero or negative
  // plot width, and every x position computed from it was NaN.
  const fullPlotWidth = Math.max(width - padding.left - padding.right, 60)
  const isSparse = axisPoints.length < SPARSE_POINT_THRESHOLD
  const plotWidth = isSparse
    ? Math.min(fullPlotWidth, SPARSE_MAX_SEGMENT_WIDTH * (axisPoints.length - 1 || 1))
    : fullPlotWidth
  const plotLeft = padding.left + (isSparse ? (fullPlotWidth - plotWidth) / 2 : 0)
  const labelEveryPoint = axisPoints.length <= LABEL_ALL_THRESHOLD

  function xFor(i) {
    return plotLeft + (axisPoints.length <= 1 ? plotWidth / 2 : (i / (axisPoints.length - 1)) * plotWidth)
  }
  function yFor(value) {
    const clamped = Math.max(yMin, Math.min(yMax, value))
    return padding.top + plotHeight - ((clamped - yMin) / (yMax - yMin)) * plotHeight
  }

  // Lifts the pen on a missing value so the line breaks there instead of
  // diving to the floor and back.
  function pathFor(seriesPoints) {
    let path = ''
    let penDown = false
    seriesPoints.forEach((p, i) => {
      if (p.value == null) {
        penDown = false
        return
      }
      path += `${penDown ? 'L' : 'M'} ${xFor(i)} ${yFor(p.value)} `
      penDown = true
    })
    return path.trim()
  }

  // On the narrowest charts the middle tick goes; floor and ceiling are what
  // actually anchor the scale.
  const gridLines = showMidGridline ? [yMin, (yMin + yMax) / 2, yMax] : [yMin, yMax]

  // Every data label this render will actually draw, as {x, y, text} — the
  // axis ticks are checked against these so one can be dropped when it would
  // duplicate a number already printed next to it (see the constants above).
  const drawnValueLabels = seriesList.flatMap((s) => {
    const lastRealIndex = s.points.reduce((last, p, i) => (p.value == null ? last : i), -1)
    return s.points
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => p.value != null && (labelEveryPoint || i === lastRealIndex))
      .map(({ p, i }) => ({ x: xFor(i), y: yFor(p.value) - 12, text: formatValue(p.value) }))
  })

  function axisLabelIsDuplicated(gridValue) {
    const text = formatValue(gridValue)
    const y = yFor(gridValue)
    return drawnValueLabels.some(
      (label) =>
        label.text === text &&
        Math.abs(label.y - y) < AXIS_LABEL_COLLISION_Y &&
        Math.abs(label.x - plotLeft) < AXIS_LABEL_COLLISION_X
    )
  }
  const slabWidth = axisPoints.length <= 1 ? plotWidth : plotWidth / (axisPoints.length - 1)
  const activeIndex = tooltip?.index ?? null

  // One readout per x-position listing every series at that period, so
  // comparing two lines never requires landing the pointer on one of them.
  function tooltipFor(index) {
    return {
      key: `x-${index}`,
      index,
      title: axisPoints[index].label,
      rows: seriesList.map((s) => ({
        label: s.label || '',
        value: s.points[index].value == null ? 'No data' : formatValue(s.points[index].value),
        color: s.color || color,
      })),
    }
  }

  return (
    <div className="chart-frame" ref={containerRef}>
      <div ref={widthRef}>
        <svg
          viewBox={`0 0 ${width} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          data-chart-density={width < CHART_NARROW ? 'compact' : 'comfortable'} role="img" aria-label="Line chart">
          {gridLines.map((g) => (
            <g key={g}>
              <line x1={plotLeft} x2={plotLeft + plotWidth} y1={yFor(g)} y2={yFor(g)} className="chart-gridline" />
              {!axisLabelIsDuplicated(g) && (
                <text x={plotLeft - 8} y={yFor(g)} textAnchor="end" dominantBaseline="middle" className="chart-axis-label">
                  {formatValue(g)}
                </text>
              )}
            </g>
          ))}

          {activeIndex != null && (
            <line
              x1={xFor(activeIndex)}
              x2={xFor(activeIndex)}
              y1={padding.top}
              y2={padding.top + plotHeight}
              className="chart-crosshair"
            />
          )}

          {axisPoints.map((p, i) => (
            <text
              key={p.label}
              x={xFor(i)}
              y={chartHeight - 6}
              textAnchor="middle"
              className={`chart-row-label${activeIndex === i ? ' is-active' : ''}`}
            >
              {p.label}
            </text>
          ))}

          {seriesList.map((s) => {
            // The direct label belongs on the last point that actually has a
            // value, not blindly on the last slot — which may be a gap.
            const lastRealIndex = s.points.reduce((last, p, i) => (p.value == null ? last : i), -1)
            const strokeColor = s.color || color
            return (
              <g key={s.label || 'series'}>
                <path
                  d={pathFor(s.points)}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  /* pathLength normalises the path to 1 unit, so the dash
                     can be expressed without measuring the real geometry —
                     which would need a layout read per series per render. */
                  pathLength={1}
                  className={`chart-line${drawn ? '' : ' is-undrawn'}`}
                />
                {s.points.map((p, i) =>
                  p.value == null ? null : (
                    <g key={p.label}>
                      <circle
                        cx={xFor(i)}
                        cy={yFor(p.value)}
                        r={activeIndex === i ? 6 : 4.5}
                        fill={strokeColor}
                        stroke="var(--color-surface)"
                        strokeWidth={2}
                        className="chart-point"
                      />
                      {(labelEveryPoint || i === lastRealIndex) && (
                        <text x={xFor(i)} y={yFor(p.value) - 12} textAnchor="middle" className="chart-value-label">
                          {formatValue(p.value)}
                        </text>
                      )}
                    </g>
                  )
                )}
              </g>
            )
          })}

          {/* Transparent full-height hit slabs, one per x-position, drawn
              last so they sit above the marks and catch every pointer. */}
          {axisPoints.map((p, i) => (
            <rect
              key={`hit-${p.label}`}
              x={xFor(i) - slabWidth / 2}
              y={padding.top}
              width={slabWidth}
              height={plotHeight}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.label}: ${seriesList
                .map((s) => `${s.label ? `${s.label} ` : ''}${s.points[i].value == null ? 'no data' : formatValue(s.points[i].value)}`)
                .join(', ')}`}
              className="chart-hit"
              {...markHandlers(tooltipFor(i))}
            />
          ))}
        </svg>
      </div>

      {axisNote && <p className="chart-axis-note">{axisNote}</p>}
      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}
