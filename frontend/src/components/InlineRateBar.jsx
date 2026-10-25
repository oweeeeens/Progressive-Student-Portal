// A rate and how it sits against the rate the school requires, small enough
// to live inside a table cell.
//
// The table it sits in already prints the number; what a number alone can't
// do is show 25% and 87.5% as obviously different sizes, or show that both
// fall short of the same line. One short track per row does that without
// adding a chart that would only restate the column beside it.
//
// The marker is the same dashed threshold the trend charts and the target
// bars use, so "the line you have to clear" looks identical everywhere in
// the product.
export function InlineRateBar({ value, required, max = 100 }) {
  if (value == null) return <span className="grade-cell__empty">—</span>

  const position = (amount) => Math.max(0, Math.min(100, (amount / max) * 100))
  const meetsRequirement = required == null || value >= required

  return (
    <span className="inline-rate">
      <span className="inline-rate__track" aria-hidden="true">
        <span
          className={`inline-rate__fill${meetsRequirement ? ' is-met' : ''}`}
          style={{ clipPath: `inset(0 ${100 - position(value)}% 0 0 round var(--radius-sm))` }}
        />
        {required != null && <span className="inline-rate__marker" style={{ left: `${position(required)}%` }} />}
      </span>
      <strong className={meetsRequirement ? undefined : 'is-below'}>{value}%</strong>
    </span>
  )
}
