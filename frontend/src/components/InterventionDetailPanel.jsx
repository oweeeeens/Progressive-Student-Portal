import { StatusPill } from './StatusPill'

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
export function InterventionDetailPanel({ intervention, studentName, onStatusChange }) {
  return (
    <div className="intervention-detail">
      <dl className="field-grid">
        {studentName && (
          <>
            <dt>Student</dt>
            <dd>{studentName}</dd>
          </>
        )}
        <dt>Type</dt>
        <dd>{INTERVENTION_TYPE_LABELS[intervention.intervention_type]}</dd>
        <dt>Date logged</dt>
        <dd>{intervention.date_logged}</dd>
        <dt>Risk at logging</dt>
        <dd>
          <StatusPill
            label={`${intervention.risk_level_at_intervention} (${intervention.grading_period_name})`}
            variant={RISK_VARIANTS[intervention.risk_level_at_intervention]}
          />
        </dd>
        <dt>Logged by</dt>
        <dd>{intervention.logged_by_name}</dd>
        <dt>Notes</dt>
        <dd>{intervention.notes || '—'}</dd>
      </dl>

      <label className="intervention-detail__status-field">
        Status
        <select value={intervention.status} onChange={(e) => onStatusChange(intervention.id, e.target.value)}>
          {Object.keys(INTERVENTION_STATUS_VARIANTS).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
