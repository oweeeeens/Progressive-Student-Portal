import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'

const STATUSES = ['present', 'absent', 'late', 'excused']

// Per-subject/period attendance, logged by the subject teacher for their own
// class_offering — separate from the adviser's daily register.
export function SubjectAttendancePage() {
  const { user } = useAuth()
  const [offerings, setOfferings] = useState([])
  const [classOfferingId, setClassOfferingId] = useState('')
  const [date, setDate] = useState('')
  const [roster, setRoster] = useState([])
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user.role === 'subject_teacher') {
      api.get('/class-offerings/mine').then((data) => setOfferings(data.classOfferings))
    }
  }, [user.role])

  useEffect(() => {
    if (!classOfferingId || !date) {
      setRoster([])
      return
    }
    setError(null)
    api
      .get(`/attendance/subject?classOfferingId=${classOfferingId}&date=${date}`)
      .then((data) => setRoster(data.roster.map((r) => ({ ...r, status: r.status || 'present' }))))
      .catch((err) => setError(err.message))
  }, [classOfferingId, date])

  function updateRow(studentId, field, value) {
    setRoster((rows) => rows.map((r) => (r.student_id === studentId ? { ...r, [field]: value } : r)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setSaving(true)
    try {
      await api.post('/attendance/subject', {
        classOfferingId: Number(classOfferingId),
        attendanceDate: date,
        entries: roster.map((r) => ({ studentId: r.student_id, status: r.status, notes: r.notes || undefined })),
      })
      setMessage('Attendance saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Attendance' }, { label: 'Subject' }]} />

      <div className="page-header">
        <h1>Subject Attendance</h1>
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
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--color-success)' }}>{message}</p>}

      {!classOfferingId || !date ? (
        <div className="empty-state">
          <p>Select a class and date to take attendance.</p>
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
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.student_id}>
                    <td>
                      {r.last_name}, {r.first_name}
                    </td>
                    <td>
                      <select value={r.status} onChange={(e) => updateRow(r.student_id, 'status', e.target.value)}>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={r.notes || ''}
                        onChange={(e) => updateRow(r.student_id, 'notes', e.target.value)}
                        placeholder="optional"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" className="btn-primary" disabled={saving} style={{ marginTop: 'var(--space-4)' }}>
            {saving ? 'Saving…' : 'Save attendance'}
          </button>
        </form>
      )}
    </div>
  )
}
