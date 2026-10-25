import { Children, cloneElement } from 'react'
import { ChevronDown } from 'lucide-react'

// A single summary figure. `icon` is a lucide-react component (the one icon
// library used across the whole app — sidebar, stat cards, action buttons).
// `variant` tints the icon only: positive/warning/negative for general
// status, risk-low/risk-medium/risk-high for the separate risk palette,
// accent for the one gold-highlighted figure a row is allowed.
// `compact` is set by a compact StatRow (see below), not passed directly by
// callers — it shrinks the icon circle/value text for a denser page.
// `onClick` turns a card into a disclosure for an explanation panel below
// the row (see StatExplainer). Opt-in per card: a figure with nothing more
// to say stays a plain, unfocusable div rather than becoming a button that
// does nothing — a control that looks pressable and isn't is worse than no
// control at all.
export function StatCard({ icon: Icon, value, label, variant, compact = false, onClick, isExpanded = false, controls }) {
  // A figure that hasn't arrived — or whose request failed — is NOT zero.
  // Pages hold these counts as null until the server answers, so a page
  // that can't load its data says so with an em dash instead of asserting
  // "0 Active sections" next to an error message explaining that nothing
  // could be read.
  const isUnknown = value == null

  const isInteractive = typeof onClick === 'function'
  const className = [
    'stat-card',
    variant ? `stat-card--${variant}` : '',
    compact ? 'stat-card--compact' : '',
    isInteractive ? 'stat-card--interactive' : '',
    isExpanded ? 'is-expanded' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      <div className="stat-card__icon">
        <Icon size={compact ? 18 : 22} strokeWidth={1.75} />
      </div>
      <div className="stat-card__body">
        <div className={`stat-card__value${isUnknown ? ' stat-card__value--unknown' : ''}`}>{isUnknown ? '—' : value}</div>
        <div className="stat-card__label">{label}</div>
      </div>
      {/* The affordance. Without it the card gives no sign there is anything
          behind it; rotated when open, it also reports which panel is
          currently showing. */}
      {isInteractive && <ChevronDown className="stat-card__chevron" size={16} strokeWidth={2} aria-hidden="true" />}
    </>
  )

  if (!isInteractive) return <div className={className}>{content}</div>

  return (
    <button type="button" className={className} onClick={onClick} aria-expanded={isExpanded} aria-controls={controls}>
      {content}
    </button>
  )
}

// `compact`: a denser variant (smaller icon circle/padding/value text) for a
// page that wants its stat row to take less vertical space — opt-in per row
// rather than the default, so other pages' stat rows are unaffected until
// they're deliberately switched over. Clones `compact` onto each StatCard
// child so callers don't have to repeat the prop on every card.
export function StatRow({ children, compact = false }) {
  return (
    <div className={`stat-row${compact ? ' stat-row--compact' : ''}`}>
      {compact ? Children.map(children, (child) => (child ? cloneElement(child, { compact: true }) : child)) : children}
    </div>
  )
}
