// A compact single-series trend line: the whole line in a de-emphasis hue,
// the most recent point picked out in the brand accent (navy) — a single
// series needs no legend box, since the chart's own label already names
// what's plotted. `points`: [{ label, value }], at least 2 needed to draw
// a line at all.
const WIDTH = 160
const HEIGHT = 40
const PADDING = 6

export function GradeSparkline({ points }) {
  if (points.length < 2) return null

  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const coords = points.map((p, i) => {
    const x = PADDING + (i / (points.length - 1)) * (WIDTH - PADDING * 2)
    const y = HEIGHT - PADDING - ((p.value - min) / range) * (HEIGHT - PADDING * 2)
    return { x, y, ...p }
  })

  const linePath = coords.map((c) => `${c.x},${c.y}`).join(' ')
  const last = coords[coords.length - 1]

  return (
    <svg
      className="grade-sparkline"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Grade trend across ${points.length} grading periods, most recent ${last.label}: ${last.value}`}
    >
      <polyline points={linePath} className="grade-sparkline__line" />
      {coords.map((c, i) => (
        <circle
          key={c.label}
          cx={c.x}
          cy={c.y}
          r={i === coords.length - 1 ? 4 : 2.5}
          className={i === coords.length - 1 ? 'grade-sparkline__point grade-sparkline__point--current' : 'grade-sparkline__point'}
        >
          <title>
            {c.label}: {c.value}
          </title>
        </circle>
      ))}
    </svg>
  )
}
