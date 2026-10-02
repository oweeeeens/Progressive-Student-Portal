// A single summary figure. `icon` is a lucide-react component (the one icon
// library used across the whole app — sidebar, stat cards, action buttons).
// `variant` tints the icon only: positive/warning/negative for general
// status, risk-low/risk-medium/risk-high for the separate risk palette,
// accent for the one gold-highlighted figure a row is allowed.
export function StatCard({ icon: Icon, value, label, variant }) {
  return (
    <div className={`stat-card${variant ? ` stat-card--${variant}` : ''}`}>
      <div className="stat-card__icon">
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <div>
        <div className="stat-card__value">{value}</div>
        <div className="stat-card__label">{label}</div>
      </div>
    </div>
  )
}

export function StatRow({ children }) {
  return <div className="stat-row">{children}</div>
}
