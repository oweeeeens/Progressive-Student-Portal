import { StatusPill } from './StatusPill'
import { useConfirm } from '../hooks/useConfirm'

export const INTERVENTION_TYPE_LABELS = {
  parent_conference: 'Parent Conference',
  tutoring_referral: 'Tutoring Referral',
  counseling_referral: 'Counseling Referral',
  attendance_follow_up: 'Attendance Follow-up',
  other: 'Other',
}
// Deliberately distinct from the risk palette (see RISK_VARIANTS below) per
// CLAUDE.md's System-Wide UI Standards — status and risk must never share a
// color vocabulary, even though both appear on the same row.
export const INTERVENTION_STATUS_VARIANTS = { open: 'neutral', monitoring: 'info', resolved: 'positive', escalated: 'negative' }
export const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }

// The single detail/edit view for one intervention: full notes, who logged
// it and against what risk level, and the status control. Used both inline
// on the Student Detail page (InterventionHistory) and as the row-expansion
// target on the standalone Interventions page — one implementation, two
// entry points, so status changes can't drift between them.
// `busy` is set by the caller while a status change it started is still in
// flight. The control is a <select>, so the risk is not a double-click but a
// second change made before the first has landed — which would race two
// writes against the same row and leave the dropdown showing whichever
// refetch answered last.
const STATUS_WORDS = { open: 'Open', monitoring: 'Monitoring', resolved: 'Resolved', escalated: 'Escalated' }

export function InterventionDetailPanel({ intervention, studentName, onStatusChange, busy = false }) {
  // A status change is a record about a named learner, made from a dropdown
  // where the wrong option is one arrow-key away — so it asks first. The
  // confirmation lives here, in the one panel both entry points share, so the
  // Interventions page and the Student Detail page cannot drift apart.
  const [confirm, confirmDialog] = useConfirm()
  async function requestStatusChange(newStatus) {
    if (newStatus === intervention.status) return
    const closing = newStatus === 'resolved' || newStatus === 'escalated'
    const typeLabel = INTERVENTION_TYPE_LABELS[intervention.intervention_type] || 'intervention'
    const ok = await confirm({
      title: `Mark as ${STATUS_WORDS[newStatus]}?`,
      message: `This ${typeLabel.toLowerCase()}${studentName ? ` for ${studentName}` : ''} will change from ${STATUS_WORDS[intervention.status]} to ${STATUS_WORDS[newStatus]}.${
        closing
          ? " Resolved and Escalated are normally set automatically at the next term's risk recalculation; setting it now means it will no longer be re-evaluated automatically."
          : ''
      }`,
      confirmLabel: `Mark ${STATUS_WORDS[newStatus]}`,
    })
    // Cancelling leaves the select on its old value: it is controlled by
    // `intervention.status`, which only changes after a successful write.
    if (ok) onStatusChange(intervention.id, newStatus)
  }

  return (
    <div className="intervention-detail">
      <dl className="field-grid">
        {studentName && (
          <div>
            <dt>Student</dt>
            <dd>{studentName}</dd>
          </div>
        )}
        <div>
          <dt>Type</dt>
          <dd>{INTERVENTION_TYPE_LABELS[intervention.intervention_type]}</dd>
        </div>
        <div>
          <dt>Date logged</dt>
          <dd>{intervention.date_logged}</dd>
        </div>
        <div>
          <dt>Risk at logging</dt>
          <dd>
            <StatusPill
              label={`${intervention.risk_level_at_intervention} (${intervention.grading_period_name})`}
              variant={RISK_VARIANTS[intervention.risk_level_at_intervention]}
            />
          </dd>
        </div>
        <div>
          <dt>Logged by</dt>
          <dd>{intervention.logged_by_name}</dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd>{intervention.notes || '—'}</dd>
        </div>
      </dl>

      <label className="intervention-detail__status-field">
        Status
        <select
          value={intervention.status}
          disabled={busy}
          onChange={(e) => requestStatusChange(e.target.value)}
        >
          {Object.keys(INTERVENTION_STATUS_VARIANTS).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {confirmDialog}
    </div>
  )
}
