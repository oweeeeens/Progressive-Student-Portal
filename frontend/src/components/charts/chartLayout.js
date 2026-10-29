// Chart geometry that depends on how wide the chart actually turned out.
//
// WHY MEASURED WIDTH AND NOT A CSS BREAKPOINT
// A chart is narrow because its CARD is narrow, and that happens on a large
// monitor just as readily as on a phone. Measured on the deployed site, the
// Analytics "Factors Over Time" small multiples were 241px wide on a 1440px
// desktop — narrower than the same chart on a 390px phone, because four of
// them share a row. A viewport media query cannot see that. The width the
// ResizeObserver already reports (see hooks/useChartWidth.js) can, so every
// threshold here is in chart pixels, and one rule serves both ends.
//
// WHAT WENT WRONG BEFORE
// Both SVG charts carried a single padding constant for every screen size.
// ColumnChart's was { top: 28, right: 100, bottom: 26, left: 44 } — 144px of
// fixed gutter. On a 360px phone the whole chart is 236px wide, so the plot
// was 92px: less than half the chart was chart. These are the measurements
// that prompted the fix:
//
//   viewport 430 -> svg 306 -> plot 162
//   viewport 390 -> svg 266 -> plot 122
//   viewport 360 -> svg 236 -> plot  92
//   viewport 320 -> svg 218 -> plot  74
//   desktop 1440 -> svg 241 -> plot  97   (four small multiples per row)
//
// WHY NOT JUST LET THE SVG SCALE
// Because useChartWidth pins the viewBox 1:1 to real pixels on purpose, so a
// label is the same size in every card. Letting the SVG scale down to fit
// would shrink the text on exactly the screen where it is already smallest.
// The geometry flexes instead; the typography does not.

// Below this, the gutters have to give. Above it nothing changes at all, so
// every chart that was already comfortable renders exactly as it did before.
export const CHART_NARROW = 360
// Below this, a chart is down to the bone: the smallest phone still in use
// (320px) lands here, and the axis sheds its middle tick.
export const CHART_TINY = 260

// Vertical space is cheap — the page scrolls — while horizontal space on a
// phone is the scarce thing. So a narrow chart gets taller rather than
// squarer, which keeps the bars and the slope readable once the plot has
// stopped being wide.
const NARROW_HEIGHT_BONUS = 30

// `left` never drops below this: it holds the y-axis tick labels, and "100%"
// at 11px needs about 28px plus its 8px offset from the plot. Shrinking it
// further does not gain plot width, it just clips the scale.
const MIN_AXIS_GUTTER = 36

// ColumnChart: { top: 28, right: 100, bottom: 26, left: 44 }, height 190.
//
// The 100px right gutter exists for one thing — parking the reference line's
// label outside the plot so it can never land on a bar. That is the right
// call when there is room to spare and an expensive one when there is not,
// so below CHART_NARROW the label moves inside the plot instead (drawn above
// the line and right-aligned, with a halo, see ColumnChart) and the gutter
// collapses to a margin.
export function columnChartLayout(width) {
  if (width >= CHART_NARROW) {
    return {
      height: 190,
      padding: { top: 28, right: 100, bottom: 26, left: 44 },
      referenceLabelInside: false,
      showMidGridline: true,
    }
  }
  if (width >= CHART_TINY) {
    return {
      height: 190 + NARROW_HEIGHT_BONUS,
      padding: { top: 28, right: 14, bottom: 26, left: MIN_AXIS_GUTTER },
      referenceLabelInside: true,
      showMidGridline: true,
    }
  }
  return {
    // The reference label now shares the plot with the bars, and at this
    // width the middle tick is the first thing that can be spared: the floor
    // and the ceiling still anchor the scale.
    height: 190 + NARROW_HEIGHT_BONUS,
    padding: { top: 32, right: 12, bottom: 26, left: MIN_AXIS_GUTTER },
    referenceLabelInside: true,
    showMidGridline: false,
  }
}

// LineChart: { top: 24, right: 52, bottom: 26, left: 44 }, height 180.
//
// Its right gutter is smaller because the labels here are centred on their
// points rather than parked outside — the gutter only has to hold the right
// half of the last point's label. 22px covers "100%" at 11px with room to
// spare, so a narrow chart keeps the label and still gains 30px of plot.
export function lineChartLayout(width) {
  if (width >= CHART_NARROW) {
    return {
      height: 180,
      padding: { top: 24, right: 52, bottom: 26, left: 44 },
      showMidGridline: true,
    }
  }
  return {
    height: 180 + NARROW_HEIGHT_BONUS,
    padding: { top: 24, right: 22, bottom: 26, left: MIN_AXIS_GUTTER },
    showMidGridline: width >= CHART_TINY,
  }
}
