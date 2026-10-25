import { useCallback, useRef, useState } from 'react'

// The shared hover/focus readout every chart on the Analytics page uses, so
// a tooltip looks and behaves the same whichever chart it came from.
//
// Three rules from the dataviz skill's interaction spec shape this:
//   - Tooltips ENHANCE, they never GATE. Everything a tooltip shows is also
//     reachable without hovering — via a direct value label on the mark, the
//     chart's legend, or the table view underneath it. Nobody has to hover
//     to read this page.
//   - Values lead, labels follow. Inside the tooltip the NUMBER is the
//     strong, high-contrast element and the series name is secondary — the
//     legend's hierarchy inverted, because a reader who has already aimed at
//     a mark knows what it is and wants the value.
//   - The same details on keyboard focus as on hover, which is why every
//     mark that calls this is focusable and `show` handles focus events
//     (which carry no pointer coordinates) as well as pointer ones.
//
// Labels here can originate from user-entered data (section names, strands),
// so they're only ever rendered as React children — i.e. as text nodes,
// escaped — never assembled into markup.

// Hover state plus the positioning maths, kept in one hook so each chart
// only has to decide WHAT to put in the tooltip, not where to put it.
export function useChartTooltip() {
  const containerRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  // `content` is { key, title, rows: [{ label, value, color }] }. The key
  // identifies the hovered mark so the chart can lift it (see the
  // `is-hovered` styling) without tracking a second piece of state.
  const show = useCallback((event, content) => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()

    // Pointer events carry real coordinates. Focus events don't (clientX is
    // 0), so for keyboard users the tooltip anchors to the top-centre of the
    // focused mark itself instead.
    const hasPointer = event.clientX != null && event.clientX !== 0
    const markRect = event.currentTarget.getBoundingClientRect()
    const x = hasPointer ? event.clientX - containerRect.left : markRect.left + markRect.width / 2 - containerRect.left
    const y = hasPointer ? event.clientY - containerRect.top : markRect.top - containerRect.top

    setTooltip({ ...content, x, y })
  }, [])

  const hide = useCallback(() => setTooltip(null), [])

  return { containerRef, tooltip, show, hide }
}

// Positioned above-and-centred on the pointer, and never interactive itself
// (pointer-events: none in CSS) so it can't steal the hover it's describing
// and flicker.
export function ChartTooltip({ tooltip }) {
  if (!tooltip) return null

  return (
    <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="status" aria-live="polite">
      {tooltip.title && <div className="chart-tooltip__title">{tooltip.title}</div>}
      {tooltip.rows.map((row) => (
        <div key={row.label} className="chart-tooltip__row">
          {/* A short stroke of the series colour, not a filled box: at
              tooltip density a box is data-weight ink doing a label's job. */}
          {row.color && <span className="chart-tooltip__key" style={{ background: row.color }} />}
          <span className="chart-tooltip__value">{row.value}</span>
          <span className="chart-tooltip__label">{row.label}</span>
        </div>
      ))}
    </div>
  )
}
