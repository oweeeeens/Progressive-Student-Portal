import { Link } from 'react-router-dom'

// Each action is either a real destination ({ to }) or a same-page action
// ({ onClick }, e.g. admin's "Post Announcement" opens the inline form
// already on this page rather than navigating anywhere) — never a dead `#`.
export function QuickActions({ actions }) {
  if (!actions || actions.length === 0) return null

  return (
    <div className="quick-actions">
      {actions.map((action) =>
        action.to ? (
          <Link key={action.label} to={action.to} className="quick-actions__item">
            <action.icon size={18} strokeWidth={1.75} />
            {action.label}
          </Link>
        ) : (
          <button key={action.label} type="button" className="quick-actions__item" onClick={action.onClick}>
            <action.icon size={18} strokeWidth={1.75} />
            {action.label}
          </button>
        )
      )}
    </div>
  )
}
