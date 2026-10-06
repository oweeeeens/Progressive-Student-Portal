import { useMemo, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, StickyNote, CheckCheck, X } from 'lucide-react'
import { Breadcrumbs } from './Breadcrumbs'
import { StatusPill } from './StatusPill'
import { useUnsavedChangesTracker } from '../hooks/useUnsavedChangesTracker'
import { addDays, todayDateString } from '../utils/dateUtils'
import './AttendanceRosterPanel.css'

const STATUSES = [
  { value: 'present', letter: 'P', label: 'Present' },
  { value: 'absent', letter: 'A', label: 'Absent' },
  { value: 'late', letter: 'L', label: 'Late' },
  { value: 'excused', letter: 'E', label: 'Excused' },
]
const SHORTCUT_TO_STATUS = Object.fromEntries(STATUSES.map((s) => [s.letter.toLowerCase(), s.value]))

// Shared by DailyAttendancePage and SubjectAttendancePage — same marking UI,
// same keyboard/search/bulk behavior, so the two feel like one consistent
// pattern rather than each page inventing its own. Each page keeps its own
// data-fetching and save-request logic (the payload's key field differs:
// sectionId vs classOfferingId), and hands this component the roster plus a
// few callbacks.
//
// `resetKey` is how this component knows "a genuinely fresh roster just
// landed" vs. "the existing roster was edited" — pass a counter the parent
// bumps exactly when that happens: right after a fetch resolves AND right
// after a save succeeds (see DailyAttendancePage's `baselineVersion`). It
// can't be derived from the picker/date alone — those are already set
// before the async fetch they triggered resolves, so they can't mark the
// moment the data itself actually arrives.
export function AttendanceRosterPanel({
  breadcrumbItems,
  title,
  pickerLabel,
  pickerValue,
  onPickerChange,
  pickerOptions,
  date,
  onDateChange,
  roster,
  onRosterChange,
  recorded, // true | false | null
  loading,
  error,
  message,
  resetKey,
  onSave,
  saving,
}) {
  const [search, setSearch] = useState('')
  const [expandedNoteIds, setExpandedNoteIds] = useState(() => new Set())

  const isDirty = useUnsavedChangesTracker(roster, resetKey, 'This attendance sheet has unsaved changes. Leave without saving?')

  function updateRow(studentId, field, value) {
    onRosterChange(roster.map((r) => (r.student_id === studentId ? { ...r, [field]: value } : r)))
  }

  function markAll(status) {
    onRosterChange(roster.map((r) => ({ ...r, status })))
  }

  function toggleNote(studentId) {
    setExpandedNoteIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  function handleRowKeyDown(e, studentId) {
    // Don't steal letter keystrokes from the notes field itself.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    const status = SHORTCUT_TO_STATUS[e.key.toLowerCase()]
    if (status) {
      e.preventDefault()
      updateRow(studentId, 'status', status)
    }
  }

  const summary = useMemo(() => {
    const counts = { present: 0, absent: 0, late: 0, excused: 0 }
    for (const r of roster) counts[r.status] = (counts[r.status] || 0) + 1
    return counts
  }, [roster])

  const filteredRoster = useMemo(() => {
    if (!search.trim()) return roster
    const q = search.trim().toLowerCase()
    return roster.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q))
  }, [roster, search])

  const ready = Boolean(pickerValue && date)

  return (
    <div className="attendance-roster-panel">
      <Breadcrumbs items={breadcrumbItems} />

      <div className="page-header">
        <h1>{title}</h1>
        <div className="page-header__actions">
          <label>
            {pickerLabel}
            <select value={pickerValue} onChange={(e) => onPickerChange(e.target.value)}>
              <option value="">-- select --</option>
              {pickerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Date
            <div className="attendance-date-nav">
              <button
                type="button"
                className="attendance-date-nav__arrow"
                onClick={() => onDateChange(addDays(date || todayDateString(), -1))}
                title="Previous day"
              >
                <ChevronLeft size={16} strokeWidth={1.75} />
              </button>
              <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
              <button
                type="button"
                className="attendance-date-nav__arrow"
                onClick={() => onDateChange(addDays(date || todayDateString(), 1))}
                title="Next day"
              >
                <ChevronRight size={16} strokeWidth={1.75} />
              </button>
              <button type="button" onClick={() => onDateChange(todayDateString())}>
                Today
              </button>
            </div>
          </label>

          {ready && recorded !== null && (
            <StatusPill label={recorded ? 'Recorded' : 'Not yet recorded'} variant={recorded ? 'positive' : 'warning'} />
          )}
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--color-success)' }}>{message}</p>}

      {!ready ? (
        <div className="empty-state">
          <p>Select a {pickerLabel.toLowerCase()} and date to take attendance.</p>
        </div>
      ) : loading ? (
        <p>Loading roster…</p>
      ) : roster.length === 0 ? (
        <div className="empty-state">
          <p>No students found.</p>
        </div>
      ) : (
        <>
          <div className="attendance-toolbar">
            <div className="attendance-toolbar__bulk">
              <button type="button" onClick={() => markAll('present')}>
                <CheckCheck size={15} strokeWidth={1.75} />
                Mark all present
              </button>
              <button type="button" onClick={() => markAll('absent')}>
                <X size={15} strokeWidth={1.75} />
                Mark all absent
              </button>
            </div>
            <div className="search-field">
              <Search size={16} strokeWidth={1.75} />
              <input
                type="search"
                placeholder="Filter by name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <p className="live-summary-bar">
            <span style={{ color: 'var(--color-success)' }}>{summary.present} present</span>
            {' · '}
            <span style={{ color: 'var(--color-danger)' }}>{summary.absent} absent</span>
            {' · '}
            <span style={{ color: 'var(--color-warning)' }}>{summary.late} late</span>
            {' · '}
            <span style={{ color: 'var(--color-text-muted)' }}>{summary.excused} excused</span>
          </p>

          {filteredRoster.length === 0 ? (
            <div className="empty-state">
              <p>No students match "{search}".</p>
            </div>
          ) : (
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
                  {filteredRoster.map((r) => {
                    const noteVisible = r.status !== 'present' || expandedNoteIds.has(r.student_id)
                    return (
                      <tr
                        key={r.student_id}
                        className="attendance-row"
                        tabIndex={0}
                        onKeyDown={(e) => handleRowKeyDown(e, r.student_id)}
                      >
                        <td>
                          {r.last_name}, {r.first_name}
                        </td>
                        <td>
                          <div className="status-segmented" role="group" aria-label="Attendance status">
                            {STATUSES.map((s) => (
                              <button
                                key={s.value}
                                type="button"
                                tabIndex={-1}
                                aria-pressed={r.status === s.value}
                                className={`status-segmented__option status-segmented__option--${s.value}${
                                  r.status === s.value ? ' is-selected' : ''
                                }`}
                                title={`${s.label} (${s.letter})`}
                                onClick={() => updateRow(r.student_id, 'status', s.value)}
                              >
                                {s.letter}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="attendance-notes-cell">
                            <button
                              type="button"
                              className={`attendance-notes-toggle${r.notes ? ' has-note' : ''}`}
                              onClick={() => toggleNote(r.student_id)}
                              title={noteVisible ? 'Hide note' : 'Add a note'}
                              aria-expanded={noteVisible}
                            >
                              <StickyNote size={15} strokeWidth={1.75} />
                            </button>
                            {noteVisible && (
                              <input
                                value={r.notes || ''}
                                onChange={(e) => updateRow(r.student_id, 'notes', e.target.value)}
                                placeholder="optional note"
                                className="attendance-notes-input"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="sticky-action-bar">
            <span className={`sticky-action-bar__status${isDirty ? ' is-dirty' : ''}`}>
              {isDirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
            {/* Not gated on isDirty — a day that's never been recorded yet
                starts "clean" relative to its own all-present defaults, but
                the adviser still needs to be able to save that as-is (e.g.
                confirming "everyone's here, no changes needed"). */}
            <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save attendance'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
