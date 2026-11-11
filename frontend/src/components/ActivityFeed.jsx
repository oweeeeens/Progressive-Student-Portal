import { GraduationCap, HeartHandshake, CalendarCheck } from 'lucide-react'
import './ActivityFeed.css'

const TYPE_ICON = {
  grade_finalized: GraduationCap,
  intervention_status_changed: HeartHandshake,
  attendance_submitted: CalendarCheck,
}

// Same cutoff/format convention as DashboardPage's own "(edited)" check —
// recent as a relative phrase, older as a plain date, not a raw ISO string.
function formatWhen(isoString) {
  const date = new Date(isoString)
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.round(diffMs / 60000)
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// A merged, read-only timeline across grades/interventions/attendance —
// see backend/models/activityModel.js for the per-type role gating (an
// empty list just means this role has nothing eligible to see, which is a
// legitimate, silent outcome, not an error).
//
// PRESENTATIONAL ONLY, like StudentsNeedingAttention beside it. It used to
// fetch its own list and return null when that list was empty, which meant
// the page could not know whether this column would exist — so the grid
// reserved 300px for something that, for some roles, can never contain
// anything. The page fetches and decides the columns.
export function ActivityFeed({ activity }) {
  if (!activity || activity.length === 0) return null

  return (
    <aside className="panel activity-panel" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Recent Activity</h2>
      <ul className="activity-feed">
        {activity.map((event, index) => {
          const Icon = TYPE_ICON[event.type]
          return (
            <li className="activity-feed__item" key={index}>
              <span className="activity-feed__icon">{Icon && <Icon size={16} strokeWidth={1.75} />}</span>
              <div>
                <p className="activity-feed__description">{event.description}</p>
                <span className="activity-feed__meta">
                  <span>{event.actorName}</span>
                  <span>{formatWhen(event.at)}</span>
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
