import { useEffect, useState } from 'react'
import { GraduationCap, FileUp, HeartHandshake, CalendarCheck } from 'lucide-react'
import { api } from '../api/client'
import './ActivityFeed.css'

const TYPE_ICON = {
  grade_finalized: GraduationCap,
  document_uploaded: FileUp,
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

// A merged, read-only timeline across grades/documents/interventions/
// attendance — see backend/models/activityModel.js for the per-type role
// gating (an empty list here just means this role has nothing eligible to
// see, which is a legitimate, silent outcome, not an error).
export function ActivityFeed() {
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .get('/dashboard/activity')
      .then((data) => setActivity(data.activity))
      .catch((err) => setError(err.message))
  }, [])

  if (error) return null
  if (activity !== null && activity.length === 0) return null

  return (
    <div className="panel">
      <h2>Recent Activity</h2>
      {!activity ? (
        <ul className="activity-feed" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li className="activity-feed__item" key={i}>
              <div className="skeleton activity-feed__icon" />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: '70%', height: '0.9375rem', marginBottom: 'var(--space-1)' }} />
                <div className="skeleton" style={{ width: '40%', height: '0.8125rem' }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="activity-feed">
          {activity.map((event, index) => {
            const Icon = TYPE_ICON[event.type]
            return (
              <li className="activity-feed__item" key={index}>
                <span className="activity-feed__icon">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
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
      )}
    </div>
  )
}
