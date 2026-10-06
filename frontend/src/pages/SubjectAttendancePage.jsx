import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { AttendanceRosterPanel } from '../components/AttendanceRosterPanel'
import { todayDateString } from '../utils/dateUtils'

// Per-subject/period attendance, logged by whoever actually teaches the
// class_offering — separate from the adviser's daily register. Same marking
// UI as DailyAttendancePage (see AttendanceRosterPanel), just scoped to a
// class offering instead of a section.
export function SubjectAttendancePage() {
  const [offerings, setOfferings] = useState([])
  const [classOfferingId, setClassOfferingId] = useState('')
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
  // See the matching comment in DailyAttendancePage.jsx for why this can't
  // just be derived from classOfferingId/date.
  const [baselineVersion, setBaselineVersion] = useState(0)

  // Not gated by role — class_offerings.teacher_id is what determines
  // "classes this person teaches," and it doesn't require the role column
  // to say 'subject_teacher' (an adviser can also be assigned to teach a
  // class). The backend scopes this the same way: /class-offerings/mine
  // returns whatever this user id actually teaches, empty if nothing.
  useEffect(() => {
    api.get('/class-offerings/mine').then((data) => setOfferings(data.classOfferings))
  }, [])

  useEffect(() => {
    if (!classOfferingId || !date) {
      setRoster([])
      setRecorded(null)
      setBaselineVersion((v) => v + 1)
      return
    }
    setError(null)
    setMessage(null)
    setLoading(true)
    api
      .get(`/attendance/subject?classOfferingId=${classOfferingId}&date=${date}`)
      .then((data) => {
        setRecorded(data.roster.some((r) => r.status != null))
        setRoster(data.roster.map((r) => ({ ...r, status: r.status || 'present' })))
        setBaselineVersion((v) => v + 1)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [classOfferingId, date])

  async function handleSave() {
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
      setRecorded(true)
      setBaselineVersion((v) => v + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AttendanceRosterPanel
      breadcrumbItems={[{ label: 'Home', to: '/' }, { label: 'Attendance' }, { label: 'Subject' }]}
      title="Subject Attendance"
      pickerLabel="Class"
      pickerValue={classOfferingId}
      onPickerChange={setClassOfferingId}
      pickerOptions={offerings.map((o) => ({
        value: o.id,
        label: `Grade ${o.grade_level} - ${o.section_name} · ${o.subject_name}`,
      }))}
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
