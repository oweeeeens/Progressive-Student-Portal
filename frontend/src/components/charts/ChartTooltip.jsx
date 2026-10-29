import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
// ...and a fourth, added when the portal was first opened on a phone: a
// touch screen has no hover at all, so on a phone the only readout was the
// direct label on the mark — exactly the label that gets crowded when the
// plot is narrow. A tap now does what a hover does.
//
// Labels here can originate from user-entered data (section names, strands),
// so they're only ever rendered as React children — i.e. as text nodes,
// escaped — never assembled into markup.

// How far a touch may travel and still count as a tap rather than a scroll.
// This number is why the hit areas do NOT call preventDefault on
// pointerdown: the marks are full-height slabs sitting in the middle of a
// scrolling page, and a chart that swallows vertical drags would stop the
// page scrolling wherever it appears — far worse than having no tooltip.
// So the gesture is allowed to proceed, and only on pointerup do we ask
// whether it stayed still enough to have been a tap.
const TAP_SLOP_PX = 8

// Keeps the tooltip this far inside the window when it would otherwise hang
// off an edge.
const VIEWPORT_MARGIN_PX = 8

// Hover state plus the positioning maths, kept in one hook so each chart
// only has to decide WHAT to put in the tooltip, not where to put it.
export function useChartTooltip() {
  const containerRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)
  // Where a touch started, so pointerup can measure how far it travelled.
  const touchStart = useRef(null)

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

  // The handlers every chart's hit area spreads onto itself, so the
  // mouse-versus-touch branching below is written once rather than copied
  // into four chart components that would then drift apart.
  const markHandlers = useCallback(
    (content) => ({
      onPointerMove: (event) => {
        // A touch "move" is a scroll in progress, not a hover.
        if (event.pointerType === 'touch') return
        show(event, content)
      },
      onPointerLeave: (event) => {
        // On touch, pointerleave fires immediately after pointerup, which
        // would dismiss the tooltip in the same frame the tap opened it.
        if (event.pointerType === 'touch') return
        hide()
      },
      onPointerDown: (event) => {
        if (event.pointerType !== 'touch') return
        touchStart.current = { x: event.clientX, y: event.clientY, key: content.key }
      },
      onPointerUp: (event) => {
        if (event.pointerType !== 'touch') return
        const start = touchStart.current
        touchStart.current = null
        if (!start) return
        const travelled = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (travelled > TAP_SLOP_PX) return // a scroll, not a tap
        // Tapping the open mark again closes it, so a tooltip is never
        // stuck on screen with no obvious way to dismiss it.
        setTooltip((current) => (current?.key === content.key ? null : { ...content, x: null, y: null, mark: event.currentTarget }))
      },
      onFocus: (event) => show(event, content),
      onBlur: hide,
    }),
    [show, hide]
  )

  // A tap-opened tooltip stays until something else happens. These are the
  // same three dismissals the account menu and the row menu already use, so
  // the whole app shares one vocabulary for "that's enough of that".
  useEffect(() => {
    if (!tooltip) return undefined
    const container = containerRef.current

    function onDocumentPointerDown(event) {
      if (!container?.contains(event.target)) hide()
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Capture phase: the page scrolls inside .app-shell__content rather than
    // the window, and scroll events do not bubble — the same reason RowMenu
    // listens in capture.
    document.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', hide, true)
    }
  }, [tooltip, hide])

  return { containerRef, tooltip, show, hide, markHandlers }
}

// Positioned above-and-centred on the pointer, and never interactive itself
// (pointer-events: none in CSS) so it can't steal the hover it's describing
// and flicker.
export function ChartTooltip({ tooltip }) {
  const ref = useRef(null)

  // Nudge the tooltip back inside the window when the mark it describes sits
  // near an edge — on a phone most marks do. Written straight to the node's
  // style rather than into state, so it cannot trigger a re-render and
  // therefore cannot loop.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !tooltip) return
    // Always measure from the UNSHIFTED position. Measuring a node that is
    // already carrying last frame's correction makes the corrections
    // accumulate, and the tooltip walks off across the screen.
    el.style.transform = ''
    el.classList.remove('chart-tooltip--below')

    const rect = el.getBoundingClientRect()
    const overflowRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN_PX)
    const overflowLeft = VIEWPORT_MARGIN_PX - rect.left
    let shiftX = 0
    if (overflowRight > 0) shiftX = -overflowRight
    else if (overflowLeft > 0) shiftX = overflowLeft

    // Above the mark is the default, but near the top of the page that puts
    // it under the sticky top bar — there it flips below instead.
    const flipBelow = rect.top < VIEWPORT_MARGIN_PX
    if (flipBelow) el.classList.add('chart-tooltip--below')
    el.style.transform = flipBelow
      ? `translate(calc(-50% + ${shiftX}px), 10px)`
      : `translate(calc(-50% + ${shiftX}px), calc(-100% - 10px))`
  }, [tooltip])

  if (!tooltip) return null

  // A tap carries no useful pointer position (the finger covers the mark),
  // so a tapped tooltip anchors to the mark itself, centred above it.
  const anchor = tooltip.mark?.getBoundingClientRect?.()
  const container = tooltip.mark?.closest?.('.chart-frame')?.getBoundingClientRect?.()
  const left = tooltip.x ?? (anchor && container ? anchor.left + anchor.width / 2 - container.left : 0)
  const top = tooltip.y ?? (anchor && container ? anchor.top - container.top : 0)

  return (
    <div ref={ref} className="chart-tooltip" style={{ left, top }} role="status" aria-live="polite">
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
