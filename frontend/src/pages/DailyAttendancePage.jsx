import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { AttendanceRosterPanel } from '../components/AttendanceRosterPanel'
import { todayDateString } from '../utils/dateUtils'

// The daily/homeroom register (DepEd SF2). admin/registrar can record for
// any section; anyone else only sees sections they actually advise in the
// picker (the server still enforces this even if the picker were
// bypassed). All the marking UI itself — segmented status buttons, bulk
// actions, search, notes, the sticky save bar — lives in
// AttendanceRosterPanel, shared with SubjectAttendancePage so both feel
// like one consistent pattern.
export function DailyAttendancePage() {
  const { user } = useAuth()
  const [sections, setSections] = useState([])
  const [sectionId, setSectionId] = useState('')
  const [date, setDate] = useState(todayDateString)
  const [roster, setRoster] = useState([])
  const [recorded, setRecorded] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)
  // Bumped every time a genuinely fresh roster lands — either just fetched
  // from the server or just saved — so AttendanceRosterPanel knows exactly
  // when to treat the current roster as its new "unsaved changes" baseline.
  // Deliberately not derived from sectionId/date: those are already set
  // before the async fetch resolves, so they can't mark the moment the
  // fetch actually completes (confirmed by testing — a page reload loaded
  // an already-recorded day and immediately, incorrectly, showed "Unsaved
  // changes" because the baseline never got the fetched data).
  const [baselineVersion, setBaselineVersion] = useState(0)

  // admin/registrar have blanket write access by role, so they get every
  // section to choose from; everyone else is scoped to sections they
  // actually advise (adviser_id) regardless of their role label — not just
  // whoever is literally labeled 'adviser', since that column doesn't have
  // to match the role column (an adviser can also teach a class elsewhere,
  // and someone whose primary role isn't 'adviser' can still be set as a
  // section's adviser_id).
  useEffect(() => {
    const path = ['admin', 'registrar'].includes(user.role) ? '/sections' : '/sections/mine'
    api.get(path).then((data) => setSections(data.sections))
  }, [user.role])

  useEffect(() => {
    if (!sectionId || !date) {
      setRoster([])
      setRecorded(null)
      setBaselineVersion((v) => v + 1)
      return
    }
    setError(null)
    setMessage(null)
    setLoading(true)
    api
      .get(`/attendance/daily?sectionId=${sectionId}&date=${date}`)
      .then((data) => {
        // A row's raw status is null when nothing's been recorded for this
        // date yet — check that BEFORE defaulting, so "Recorded" vs. "Not
        // yet recorded" reflects the real server state, not the UI default.
        setRecorded(data.roster.some((r) => r.status != null))
        setRoster(data.roster.map((r) => ({ ...r, status: r.status || 'present' })))
        setBaselineVersion((v) => v + 1)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [sectionId, date])

  async function handleSave() {
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
      setRecorded(true)
      setBaselineVersion((v) => v + 1) // marks the just-saved roster as the new baseline
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AttendanceRosterPanel
      breadcrumbItems={[{ label: 'Home', to: '/' }, { label: 'Attendance' }, { label: 'Daily (SF2)' }]}
      title="Daily Attendance (SF2)"
      pickerLabel="Section"
      pickerValue={sectionId}
      onPickerChange={setSectionId}
      pickerOptions={sections.map((s) => ({ value: s.id, label: `Grade ${s.grade_level} - ${s.name}` }))}
      date={date}
      onDateChange={setDate}
      roster={roster}
      onRosterChange={setRoster}
      recorded={recorded}
      loading={loading}
      error={error}
      message={message}
      resetKey={baselineVersion}
      onSave={handleSave}
      saving={saving}
    />
  )
}
