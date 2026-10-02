import { useEffect, useState } from 'react'
import { Calendar, List } from 'lucide-react'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import { AttendanceCalendar } from './AttendanceCalendar'

const STATUS_VARIANTS = { present: 'positive', late: 'warning', absent: 'negative', excused: 'neutral' }

export function AttendanceHistory({ studentId, kind, title }) {
  const [history, setHistory] = useState(null) // { records, summary }
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState('calendar')

  useEffect(() => {
    api
      .get(`/students/${studentId}/attendance/${kind}`)
      .then(setHistory)
      .catch((err) => setError(err.message))
  }, [studentId, kind])

  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>
  if (!history) return <p>Loading…</p>

  return (
    <div className="record-section">
      <div className="record-section__header-row">
        <h2>{title}</h2>
        {history.records.length > 0 && (
          <div className="view-toggle">
            <button type="button" className={viewMode === 'calendar' ? 'is-active' : ''} onClick={() => setViewMode('calendar')}>
              <Calendar size={14} strokeWidth={1.75} /> Calendar
            </button>
            <button type="button" className={viewMode === 'list' ? 'is-active' : ''} onClick={() => setViewMode('list')}>
              <List size={14} strokeWidth={1.75} /> List
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        {Object.entries(history.summary).map(([status, count]) => (
          <StatusPill key={status} label={`${count} ${status}`} variant={STATUS_VARIANTS[status]} />
        ))}
      </div>

      {history.records.length === 0 ? (
        <div className="empty-state">
          <p>No attendance recorded yet.</p>
          <p>Records appear here once attendance is taken for this student.</p>
        </div>
      ) : viewMode === 'calendar' ? (
        <AttendanceCalendar records={history.records.map((r) => ({ date: r.attendance_date, status: r.status }))} />
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                {kind === 'subject' && <th>Subject / Section</th>}
                <th>Notes</th>
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {history.records.map((r) => (
                <tr key={r.id}>
                  <td>{r.attendance_date}</td>
                  <td>
                    <StatusPill label={r.status} variant={STATUS_VARIANTS[r.status]} />
                  </td>
                  {kind === 'subject' && (
                    <td>
                      {r.subject_name} / {r.section_name}
                    </td>
                  )}
                  <td>{r.notes || '—'}</td>
                  <td>{r.recorded_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
