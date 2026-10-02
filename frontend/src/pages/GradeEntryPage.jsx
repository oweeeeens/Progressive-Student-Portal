import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'

// Subject teacher enters raw (draft) grades for their own class. These do
// NOT count toward risk until the student's adviser finalizes them — see
// GradeFinalizationPage.
export function GradeEntryPage() {
  const [offerings, setOfferings] = useState([])
  const [periods, setPeriods] = useState([])
  const [classOfferingId, setClassOfferingId] = useState('')
  const [gradingPeriodId, setGradingPeriodId] = useState('')
  const [roster, setRoster] = useState([])
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/class-offerings/mine').then((data) => setOfferings(data.classOfferings))
    api.get('/grading-periods').then((data) => setPeriods(data.gradingPeriods))
  }, [])

  useEffect(() => {
    if (!classOfferingId) {
      setRoster([])
      return
    }
    setError(null)
    api
      .get(`/class-offerings/${classOfferingId}/roster`)
      .then((data) => setRoster(data.roster.map((s) => ({ ...s, student_id: s.id, gradeValue: '' }))))
      .catch((err) => setError(err.message))
  }, [classOfferingId])

  function updateGrade(studentId, value) {
    setRoster((rows) => rows.map((r) => (r.student_id === studentId ? { ...r, gradeValue: value } : r)))
  }

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
      setMessage("Grades saved as draft. The student's adviser must finalize them before they count toward risk scoring.")
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

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

      {!classOfferingId ? (
        <div className="empty-state">
          <p>Select a class to enter grades.</p>
        </div>
      ) : roster.length === 0 ? (
        <div className="empty-state">
          <p>No students found for this class.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Grade (60-100)</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.student_id}>
                    <td>
                      {r.last_name}, {r.first_name}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="60"
                        max="100"
                        step="0.01"
                        value={r.gradeValue}
                        onChange={(e) => updateGrade(r.student_id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" className="btn-primary" disabled={saving} style={{ marginTop: 'var(--space-4)' }}>
            {saving ? 'Saving…' : 'Save as draft'}
          </button>
        </form>
      )}
    </div>
  )
}
