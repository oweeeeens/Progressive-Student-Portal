import { Fragment, useEffect, useState } from 'react'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import { InterventionDetailPanel, INTERVENTION_TYPE_LABELS, INTERVENTION_STATUS_VARIANTS } from './InterventionDetailPanel'

// Resolved/Escalated are normally set automatically by the risk engine on
// the next recalculation (see riskEngine.js) — Open/Monitoring are the two
// manual states an adviser/counselor progresses through while following up.
// The status dropdown (inside InterventionDetailPanel) still allows any
// value as a manual override/escape hatch.
export function InterventionHistory({ studentId }) {
  const [interventions, setInterventions] = useState(null)
  const [error, setError] = useState(null)
  const [type, setType] = useState('parent_conference')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  function load() {
    api
      .get(`/students/${studentId}/interventions`)
      .then((data) => setInterventions(data.interventions))
      .catch((err) => setError(err.message))
  }

  useEffect(load, [studentId])

  async function handleLog(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post(`/students/${studentId}/interventions`, { interventionType: type, notes })
      setNotes('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(id, status) {
    try {
      await api.patch(`/interventions/${id}/status`, { status })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id))
  }

  if (!interventions) return <p>Loading…</p>

  return (
    <div className="record-section">
      <h2>Interventions</h2>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <form onSubmit={handleLog} className="panel intervention-log-form">
        <h3>Log a new intervention</h3>
        <div className="intervention-log-form__fields">
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(INTERVENTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <input
              placeholder="What happened, and what's the plan?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Logging…' : 'Log Intervention'}
        </button>
      </form>

      {interventions.length === 0 ? (
        <div className="empty-state">
          <p>No interventions logged yet.</p>
          <p>Log one above when this student needs follow-up.</p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Status</th>
                <th>Logged by</th>
              </tr>
            </thead>
            <tbody>
              {interventions.map((i) => (
                <Fragment key={i.id}>
                  <tr
                    className="is-clickable-row"
                    tabIndex={0}
                    role="button"
                    aria-expanded={expandedId === i.id}
                    onClick={() => toggleExpanded(i.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleExpanded(i.id)
                      }
                    }}
                  >
                    <td>{i.date_logged}</td>
                    <td>{INTERVENTION_TYPE_LABELS[i.intervention_type]}</td>
                    <td>
                      <StatusPill label={i.status} variant={INTERVENTION_STATUS_VARIANTS[i.status]} />
                    </td>
                    <td>{i.logged_by_name}</td>
                  </tr>
                  {expandedId === i.id && (
                    <tr className="detail-row">
                      <td colSpan={4}>
                        <InterventionDetailPanel intervention={i} onStatusChange={handleStatusChange} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
