// A single piece of standing context — "what school year is it", "which
// grading period are we in", "am I enrolled". Deliberately NOT a StatCard:
// a stat card reports a figure that moves (an average, a count, a rate),
// while these are states that hold for weeks at a time, so they get the
// quieter label-above-value treatment and a soft-tinted icon tile instead
// of a circled accent icon.
//
// `tone` tints the icon tile only (primary / accent / success / info) — the
// card itself stays on the surface color so a row of three doesn't read as
// three different statuses.
export function ContextCard({ icon: Icon, label, value, tone = 'primary' }) {
  return (
    <div className="context-card">
      <div className="context-card__body">
        <span className="context-card__label">{label}</span>
        <span className="context-card__value">{value}</span>
      </div>
      <div className={`context-card__icon context-card__icon--${tone}`}>
        <Icon size={20} strokeWidth={1.75} />
      </div>
    </div>
  )
}

// The three-across row these sit in. Collapses to one column on narrow
// screens rather than squeezing three large values into phone width.
export function ContextCardRow({ children }) {
  return <div className="context-card-row">{children}</div>
}
