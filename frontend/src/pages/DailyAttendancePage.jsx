import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'

const STATUSES = ['present', 'absent', 'late', 'excused']

// The adviser's daily/homeroom register (DepEd SF2). admin/registrar can
// record for any section; an adviser only sees their own in the picker (the
// server still enforces this even if the picker were bypassed).
export function DailyAttendancePage() {
  const { user } = useAuth()
  const [sections, setSections] = useState([])
  const [sectionId, setSectionId] = useState('')
  const [date, setDate] = useState('')
  const [roster, setRoster] = useState([])
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const path = user.role === 'adviser' ? '/sections/mine' : '/sections'
    api.get(path).then((data) => setSections(data.sections))
  }, [user.role])

  useEffect(() => {
    if (!sectionId || !date) {
      setRoster([])
      return
    }
    setError(null)
    api
      .get(`/attendance/daily?sectionId=${sectionId}&date=${date}`)
      .then((data) => setRoster(data.roster.map((r) => ({ ...r, status: r.status || 'present' }))))
      .catch((err) => setError(err.message))
  }, [sectionId, date])

  function updateRow(studentId, field, value) {
    setRoster((rows) => rows.map((r) => (r.student_id === studentId ? { ...r, [field]: value } : r)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setSaving(true)
    try {
      await api.post('/attendance/daily', {
        sectionId: Number(sectionId),
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
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Attendance' }, { label: 'Daily (SF2)' }]} />

      <div className="page-header">
        <h1>Daily Attendance (SF2)</h1>
        <div className="page-header__actions">
          <label>
            Section
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">-- select --</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Grade {s.grade_level} - {s.name}
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

      {!sectionId || !date ? (
        <div className="empty-state">
          <p>Select a section and date to take attendance.</p>
        </div>
      ) : roster.length === 0 ? (
        <div className="empty-state">
          <p>No students found for this section.</p>
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
