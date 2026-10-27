import { useEffect, useMemo, useState } from 'react'
import { Calendar, List, FileUp } from 'lucide-react'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import { DataTable, fieldValue } from './table/DataTable'
import { AttendanceCalendar } from './AttendanceCalendar'
import { Alert } from './Alert'

const STATUS_VARIANTS = { present: 'positive', late: 'warning', absent: 'negative', excused: 'neutral' }

export function AttendanceHistory({ studentId, kind, title }) {
  const [history, setHistory] = useState(null) // { records, summary } — unfiltered, every period on record
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState('calendar')
  const [periodId, setPeriodId] = useState(null) // null until records load, then defaults to the most recent one

  useEffect(() => {
    api
      .get(`/students/${studentId}/attendance/${kind}`)
      .then((data) => {
        setHistory(data)
        // Records come back newest-first, so the first row's period is the
        // most recent one with data — in practice this is "the current
        // grading period" for an actively-tracked student.
        setPeriodId(data.records[0]?.grading_period_id ?? null)
      })
      .catch((err) => setError(err.message))
  }, [studentId, kind])

  // SF2 attendance is normally read one grading period at a time, not as a
  // running lifetime total — so everything below (pills, calendar, list) is
  // scoped to whichever period is selected, defaulting to the most recent.
  const periodOptions = useMemo(() => {
    if (!history) return []
    const seen = new Map()
    for (const r of history.records) {
      if (!seen.has(r.grading_period_id)) seen.set(r.grading_period_id, r.grading_period_name)
    }
    // history.records is newest-first, so insertion order already lists
    // periods most-recent-first.
    return Array.from(seen, ([id, name]) => ({ id, name }))
  }, [history])

  const periodRecords = useMemo(
    () => (history ? history.records.filter((r) => r.grading_period_id === periodId) : []),
    [history, periodId]
  )

  const periodSummary = useMemo(() => {
    const summary = { present: 0, absent: 0, late: 0, excused: 0 }
    for (const r of periodRecords) summary[r.status] += 1
    return summary
  }, [periodRecords])

  // Reshaped once per actual data change, not on every render — passing a
  // fresh .map() literal straight into the prop below would give
  // AttendanceCalendar a new array reference every render, defeating its
  // own internal memoization (which depends on this array).
  const calendarRecords = useMemo(
    () => periodRecords.map((r) => ({ date: r.attendance_date, status: r.status })),
    [periodRecords]
  )

  if (error) return <Alert>{error}</Alert>
  if (!history) return <p>Loading…</p>

  const selectedPeriodName = periodOptions.find((p) => p.id === periodId)?.name

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

      {periodOptions.length > 1 && (
        <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-3)', fontSize: 'var(--font-size-sm)' }}>
          Grading period
          <select value={periodId ?? ''} onChange={(e) => setPeriodId(Number(e.target.value))}>
            {periodOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        {Object.entries(periodSummary).map(([status, count]) => (
          <StatusPill key={status} label={`${count} ${status}`} variant={STATUS_VARIANTS[status]} />
        ))}
        {selectedPeriodName && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}>({selectedPeriodName})</span>
        )}
      </div>

      {history.records.length === 0 ? (
        <div className="empty-state">
          <p>No attendance recorded yet.</p>
          <p>Records appear here once attendance is taken for this student.</p>
        </div>
      ) : viewMode === 'calendar' ? (
        // Keyed on periodId so switching periods remounts the calendar and
        // re-derives its initial month from the new period's records —
        // AttendanceCalendar's viewDate is state seeded once from `records`
        // on mount, so without a fresh key it would stay on whatever month
        // was last viewed even after the underlying data changes period.
        <AttendanceCalendar key={periodId} records={calendarRecords} />
      ) : (
        <DataTable illustration="calendar"
          columns={[
            { key: 'date', header: 'Date', render: (r) => r.attendance_date },
            ...(kind === 'subject'
              ? [
                  {
                    key: 'subject',
                    header: 'Subject / Section',
                    truncate: true,
                    render: (r) => `${r.subject_name} / ${r.section_name}`,
                  },
                ]
              : []),
            { key: 'notes', header: 'Notes', truncate: true, render: (r) => fieldValue(r.notes) },
            {
              // Who recorded it, and — for a row that came from a bulk
              // import rather than the marking sheet — which file it came
              // from. `imported_from` is null on every hand-marked row, so
              // the second line appears only where it means something.
              key: 'by',
              header: 'Recorded by',
              render: (r) => (
                <>
                  {fieldValue(r.recorded_by_name)}
                  {r.imported_from && (
                    <span className="attendance-history__source" title={`Imported from ${r.imported_from}`}>
                      <FileUp size={12} strokeWidth={1.75} aria-hidden="true" />
                      {r.imported_from}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              uniformValue: (r) => r.status,
              render: (r) => <StatusPill label={r.status} variant={STATUS_VARIANTS[r.status]} />,
            },
          ]}
          rows={periodRecords}
          rowKey={(r) => r.id}
          emptyState={
            <>
              <p>No attendance recorded yet.</p>
              <p>Records appear here once attendance is taken for this student.</p>
            </>
          }
        />
      )}
    </div>
  )
}
