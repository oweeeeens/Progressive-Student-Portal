import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { useUnsavedChangesTracker } from '../hooks/useUnsavedChangesTracker'
import './GradesShared.css'

const STATUS_LABELS = {
  submitted: 'Submitted',
  principal_verified: 'Principal-verified',
  rejected: 'Rejected',
  finalized: 'Finalized',
}
const STATUS_VARIANTS = {
  submitted: 'warning',
  principal_verified: 'info',
  rejected: 'negative',
  finalized: 'positive',
}

// Subject teacher submits grades for their own class. This is only the
// first step of CLAUDE.md's 3-stage approval chain — the principal must
// verify them (see VerifyGradesPage) and the student's adviser must
// finalize them (see GradeFinalizationPage) before they count toward risk
// scoring. A rejected submission comes back here with the principal's note
// so the teacher knows what to fix before resubmitting.
export function GradeEntryPage() {
  const [offerings, setOfferings] = useState([])
  const [periods, setPeriods] = useState([])
  const [classOfferingId, setClassOfferingId] = useState('')
  const [gradingPeriodId, setGradingPeriodId] = useState('')
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)
  // Bumped whenever a genuinely fresh roster lands — fetch resolves or a
  // submit succeeds — so useUnsavedChangesTracker knows exactly when to
  // treat the current roster as its new baseline. Can't be derived from
  // classOfferingId/gradingPeriodId alone: those are set before the async
  // fetch they triggered resolves. See AttendanceRosterPanel's matching
  // pattern (same hook) for the full reasoning.
  const [baselineVersion, setBaselineVersion] = useState(0)

  useEffect(() => {
    api.get('/class-offerings/mine').then((data) => setOfferings(data.classOfferings))
    api.get('/grading-periods').then((data) => setPeriods(data.gradingPeriods))
  }, [])

  useEffect(() => {
    if (!classOfferingId) {
      setRoster([])
      setBaselineVersion((v) => v + 1)
      return
    }
    setError(null)
    setLoading(true)
    Promise.all([
      api.get(`/class-offerings/${classOfferingId}/roster`),
      gradingPeriodId
        ? api.get(`/grades/by-offering?classOfferingId=${classOfferingId}&gradingPeriodId=${gradingPeriodId}`)
        : Promise.resolve({ submissions: [] }),
    ])
      .then(([rosterData, submissionData]) => {
        const byStudent = new Map(submissionData.submissions.map((s) => [s.student_id, s]))
        setRoster(
          rosterData.roster.map((s) => {
            const existing = byStudent.get(s.id)
            return {
              ...s,
              student_id: s.id,
              gradeValue: existing ? String(existing.grade_value) : '',
              status: existing?.status ?? null,
              rejectionNote: existing?.rejection_note ?? null,
            }
          })
        )
        setBaselineVersion((v) => v + 1)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [classOfferingId, gradingPeriodId])

  const isDirty = useUnsavedChangesTracker(
    roster,
    baselineVersion,
    'This grade sheet has unsaved changes. Leave without saving?'
  )

  function updateGrade(studentId, value) {
    setRoster((rows) => rows.map((r) => (r.student_id === studentId ? { ...r, gradeValue: value } : r)))
  }

  const summary = useMemo(() => {
    const entered = roster.filter((r) => r.gradeValue !== '').length
    return { entered, missing: roster.length - entered }
  }, [roster])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!gradingPeriodId) {
      setError('Select a grading period.')
      return
    }
    const entries = roster
      .filter((r) => r.gradeValue !== '' && r.gradeValue != null)
      .map((r) => ({ studentId: r.student_id, gradeValue: Number(r.gradeValue) }))
    if (entries.length === 0) {
      setError('Enter at least one grade.')
      return
    }

    setSaving(true)
    try {
      await api.post('/grades', { classOfferingId: Number(classOfferingId), gradingPeriodId: Number(gradingPeriodId), entries })
      setMessage('Grades submitted — awaiting principal verification before your adviser can finalize them.')
      setRoster((rows) =>
        rows.map((r) =>
          r.gradeValue !== '' && r.gradeValue != null ? { ...r, status: 'submitted', rejectionNote: null } : r
        )
      )
      setBaselineVersion((v) => v + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const ready = Boolean(classOfferingId)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Grades' }, { label: 'Enter' }]} />

      <div className="page-header">
        <h1>Enter Grades</h1>
        <div className="page-header__actions">
          <label>
            Class
            <select value={classOfferingId} onChange={(e) => setClassOfferingId(e.target.value)}>
              <option value="">-- select --</option>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  Grade {o.grade_level} - {o.section_name} · {o.subject_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grading Period
            <select value={gradingPeriodId} onChange={(e) => setGradingPeriodId(e.target.value)}>
              <option value="">-- select --</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--color-success)' }}>{message}</p>}

      {!ready ? (
        <div className="empty-state">
          <p>Select a class to enter grades.</p>
        </div>
      ) : loading ? (
        <p>Loading roster…</p>
      ) : roster.length === 0 ? (
        <div className="empty-state">
          <p>No students found for this class.</p>
        </div>
      ) : (
        <>
          <p className="live-summary-bar">
            <span style={{ color: 'var(--color-success)' }}>{summary.entered} entered</span>
            {' · '}
            <span style={{ color: summary.missing > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
              {summary.missing} missing
            </span>
          </p>

          <form onSubmit={handleSubmit}>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Grade (60-100)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => {
                    const isMissing = r.gradeValue === ''
                    return (
                      <tr key={r.student_id} className={isMissing ? 'grade-row--missing' : undefined}>
                        <td>
                          {r.last_name}, {r.first_name}
                          {isMissing && <span className="grade-missing-badge">No grade yet</span>}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="60"
                            max="100"
                            step="0.01"
                            value={r.gradeValue}
                            onChange={(e) => updateGrade(r.student_id, e.target.value)}
                            className={isMissing ? 'grade-input--missing' : undefined}
                          />
                        </td>
                        <td>
                          {r.status && <StatusPill label={STATUS_LABELS[r.status]} variant={STATUS_VARIANTS[r.status]} />}
                          {r.status === 'rejected' && r.rejectionNote && (
                            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                              {r.rejectionNote}
                            </p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="sticky-action-bar">
              <span className={`sticky-action-bar__status${isDirty ? ' is-dirty' : ''}`}>
                {isDirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Submitting…' : 'Submit for review'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  )
}
