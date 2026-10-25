import { ChartTooltip, useChartTooltip } from './ChartTooltip'

// Horizontal bars around a zero line — the form for a SIGNED value, where
// the sign is the point: which subjects went up, which went down, and by
// how much.
//
// Why this is not BarChart with a colour: a bar encodes magnitude by
// length, so a 6-point gain and a 6-point drop drawn from the same left
// edge are the same bar, and only the colour would say which is which.
// Direction then rests on colour alone, which fails the moment the page is
// printed, read by a colourblind student, or glanced at quickly. Here the
// direction is the geometry — right of the line is better, left is worse —
// and colour merely reinforces it.
//
// `rows`: [{ key, label, value, detail? }] where value is the change, signed.
// The scale is symmetric around zero so a 10-point gain and a 10-point drop
// are the same length on opposite sides; a floor keeps a one-point change
// from filling half the chart.
const MINIMUM_SCALE = 10
// Half the track is each side of the zero line, so a bar never exceeds 50%.
const MAX_BAR_PERCENT = 50
// A real but tiny change still gets a visible sliver.
const MINIMUM_BAR_PERCENT = 1.5

export function ChangeBarChart({
  rows,
  formatValue = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`,
  positiveColor = 'var(--band-performing-well)',
  negativeColor = 'var(--band-at-risk-high)',
}) {
  const { containerRef, tooltip, show, hide } = useChartTooltip()
  const scale = Math.max(MINIMUM_SCALE, ...rows.map((r) => Math.abs(r.value)))
  // Same floor rule as BarChart: the stylesheet's 180px keeps a bar chart as
  // tall as a line chart beside it, which is right from about five rows up.
  // Below that it is mostly empty card with a bar floating in it, so a short
  // chart gets a floor its own rows can fill. Row geometry comes from the
  // same tokens the stylesheet uses, so the two cannot drift apart.
  const minHeight = `min(180px, calc(${rows.length} * var(--chart-row-height) + var(--space-4)))`

  return (
    <div className="change-bar-chart" ref={containerRef} style={{ '--bar-chart-min-height': minHeight }}>
      {rows.map((row) => {
        const isZero = row.value === 0
        const percent = isZero ? 0 : Math.max((Math.abs(row.value) / scale) * MAX_BAR_PERCENT, MINIMUM_BAR_PERCENT)
        const isPositive = row.value > 0
        const color = isPositive ? positiveColor : negativeColor
        const valueText = formatValue(row.value)
        const content = {
          key: row.key,
          title: row.label,
          rows: [{ label: '', value: valueText, color }, ...(row.detail ? [{ label: row.detail, value: '' }] : [])],
        }

        return (
          <div
            key={row.key}
            className={`change-bar-chart__row${tooltip?.key === row.key ? ' is-hovered' : ''}`}
            tabIndex={0}
            role="button"
            aria-label={`${row.label}: ${valueText}${row.detail ? `, ${row.detail}` : ''}`}
            onPointerMove={(e) => show(e, content)}
            onPointerLeave={hide}
            onFocus={(e) => show(e, content)}
            onBlur={hide}
          >
            <span className="change-bar-chart__label" title={row.label}>
              {row.label}
            </span>
            <span className="change-bar-chart__track">
              {/* The zero line is the chart's whole reference: it is drawn
                  under every bar, not just implied by where they start. */}
              <span className="change-bar-chart__zero" />
              {isZero ? (
                <span className="change-bar-chart__unchanged" />
              ) : (
                <span
                  className="change-bar-chart__fill"
                  style={{
                    left: isPositive ? `${MAX_BAR_PERCENT}%` : `${MAX_BAR_PERCENT - percent}%`,
                    width: `${percent}%`,
                    background: color,
                  }}
                />
              )}
            </span>
            <span className="change-bar-chart__value">{valueText}</span>
          </div>
        )
      })}
      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}
