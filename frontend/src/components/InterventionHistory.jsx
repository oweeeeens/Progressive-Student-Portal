import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import { DataTable, fieldValue } from './table/DataTable'
import { InterventionDetailPanel, INTERVENTION_TYPE_LABELS, INTERVENTION_STATUS_VARIANTS } from './InterventionDetailPanel'
import { Alert } from './Alert'
import { SkeletonTable } from './Skeleton'
import { useWriteFeedback } from '../hooks/useWriteFeedback'

// Resolved/Escalated are normally set automatically by the risk engine on
// the next recalculation (see riskEngine.js) — Open/Monitoring are the two
// manual states an adviser/counselor progresses through while following up.
// The status dropdown (inside InterventionDetailPanel) still allows any
// value as a manual override/escape hatch.
export function InterventionHistory({ studentId }) {
  const [interventions, setInterventions] = useState(null)
  const [type, setType] = useState('parent_conference')
  const [notes, setNotes] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // Same three concerns as the standalone Interventions page, through the
  // same hook — logging an intervention is a record about a named minor, so
  // "did that save?" should not be answered by inference.
  const { error, setError, notice, busyKey, runWrite } = useWriteFeedback()

  function load() {
    api
      .get(`/students/${studentId}/interventions`)
      .then((data) => setInterventions(data.interventions))
      .catch((err) => setError(err.message))
  }

  useEffect(load, [studentId, setError])

  async function handleLog(e) {
    e.preventDefault()
    const typeLabel = INTERVENTION_TYPE_LABELS[type] || type
    await runWrite(
      'log',
      async () => {
        await api.post(`/students/${studentId}/interventions`, { interventionType: type, notes })
        setNotes('')
        load()
      },
      `${typeLabel} logged.`
    )
  }

  async function handleStatusChange(id, status) {
    await runWrite(
      `status-${id}`,
      async () => {
        await api.patch(`/interventions/${id}/status`, { status })
        load()
      },
      `Intervention marked ${status.replace(/_/g, ' ')}.`
    )
  }

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id))
  }

  if (!interventions) return <SkeletonTable rows={3} columns={4} />

  return (
    <div className="record-section">
      <h2>Interventions</h2>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

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
        <button type="submit" className="btn-primary" disabled={busyKey === 'log'}>
          {busyKey === 'log' ? 'Logging…' : 'Log Intervention'}
        </button>
      </form>

              <DataTable illustration="support"
          columns={[
            { key: 'type', header: 'Type', render: (i) => INTERVENTION_TYPE_LABELS[i.intervention_type] },
            { key: 'date', header: 'Date logged', render: (i) => fieldValue(i.date_logged) },
            { key: 'by', header: 'Logged by', render: (i) => fieldValue(i.logged_by_name) },
            {
              key: 'status',
              header: 'Status',
              uniformValue: (i) => i.status,
              render: (i) => <StatusPill label={i.status} variant={INTERVENTION_STATUS_VARIANTS[i.status]} />,
            },
          ]}
          rows={interventions}
          rowKey={(i) => i.id}
          onRowClick={(i) => toggleExpanded(i.id)}
          renderExpanded={(i) =>
            expandedId === i.id ? (
              <InterventionDetailPanel
                intervention={i}
                onStatusChange={handleStatusChange}
                busy={busyKey === `status-${i.id}`}
              />
            ) : null
          }
          rowActions={(i) => [
            {
              key: 'toggle',
              label: expandedId === i.id ? 'Hide details' : 'View details',
              icon: Eye,
              onSelect: () => toggleExpanded(i.id),
            },
          ]}
          emptyState={
            <>
              <p>No interventions logged for this student.</p>
              <p>Log one from Academic Progress Tracking when they need follow-up.</p>
            </>
          }
        />
    </div>
  )
}
