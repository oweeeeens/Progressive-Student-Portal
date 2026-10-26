import { ChartTooltip, useChartTooltip } from './ChartTooltip'
import { useDrawIn } from '../../hooks/useDrawIn'

// Horizontal bars — the ONE form for comparing categories. One row per
// category: label left, bar middle, value right. Never stacked, never
// segmented: a stacked bar makes the reader measure segments against a
// moving start point, which is the opposite of reading in two seconds.
//
// Plain HTML/CSS rather than SVG. A bar chart with a text label on each
// side is a three-column layout, and CSS grid does that natively — an SVG
// would mean hand-measuring label widths, and its text scales with the
// viewBox instead of staying at the CSS size.
//
// Row geometry (16px bar, 28px row) lives in the stylesheet next to every
// other chart measurement, so "all charts are the same height" is enforced
// in one place rather than re-derived per chart.
//
// `rows`: [{ key, label, value, color?, valueText?, detail? }]
// `maxValue`: pass an explicit shared maximum when several of these sit
// side by side (one per grading period) so their bars are comparable —
// without it each chart scales to its own largest row and two charts that
// look identical can mean completely different numbers.
export function BarChart({ rows, maxValue, formatValue = (v) => String(v), color = 'var(--chart-blue)' }) {
  const { containerRef, tooltip, show, hide } = useChartTooltip()
  // Mounts collapsed and releases on the next frame, so the clip-path
  // transition on .bar-chart__fill finally has something to animate from.
  // It was always the right technique; it just never fired.
  const drawn = useDrawIn()
  const max = maxValue ?? Math.max(1, ...rows.map((r) => r.value))
  // The stylesheet's 180px floor keeps a bar chart as tall as a line chart
  // next to it, which is right from about five rows up. Below that the
  // floor is mostly empty card with a bar floating in the middle, so short
  // charts get a floor their own rows can actually fill. Row geometry is
  // read from the same tokens the stylesheet uses, so this can't drift from
  // the real row height.
  const minHeight = `min(180px, calc(${rows.length} * var(--chart-row-height) + var(--space-4)))`

  return (
    <div className="bar-chart" ref={containerRef} style={{ '--bar-chart-min-height': minHeight }}>
      {rows.map((row) => {
        const isZero = row.value <= 0
        const percent = isZero ? 0 : Math.max((row.value / max) * 100, 1.5)
        const valueText = row.valueText ?? formatValue(row.value)
        const content = {
          key: row.key,
          title: row.label,
          rows: [
            { label: '', value: valueText, color: row.color || color },
            ...(row.detail ? [{ label: row.detail, value: '' }] : []),
          ],
        }

        return (
          <div
            key={row.key}
            className={`bar-chart__row${tooltip?.key === row.key ? ' is-hovered' : ''}`}
            tabIndex={0}
            role="button"
            aria-label={`${row.label}: ${valueText}`}
            onPointerMove={(e) => show(e, content)}
            onPointerLeave={hide}
            onFocus={(e) => show(e, content)}
            onBlur={hide}
          >
            <span className="bar-chart__label" title={row.label}>
              {row.label}
            </span>
            <span className="bar-chart__track">
              {/* A zero row still gets a thin neutral stub — a bare gap with
                  a "0" floating beside it reads as a rendering fault rather
                  than a real zero. */}
              {/* Revealed by clip-path rather than sized by width: the bar
                  animates to its new length on the compositor instead of
                  re-laying out the row on every frame. See .bar-chart__fill. */}
              <span
                className={`bar-chart__fill${isZero ? ' is-zero' : ''}`}
                style={
                  isZero
                    ? undefined
                    : {
                        clipPath: `inset(0 ${drawn ? 100 - percent : 100}% 0 0 round var(--radius-sm))`,
                        background: row.color || color,
                      }
                }
              />
            </span>
            <span className="bar-chart__value">{valueText}</span>
          </div>
        )
      })}
      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}
