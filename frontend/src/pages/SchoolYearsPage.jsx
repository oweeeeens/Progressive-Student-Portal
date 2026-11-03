import { useEffect, useState } from 'react'
import { Plus, CalendarRange, Star, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { canManageAcademicSetup } from '../utils/permissions'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { SkeletonTable } from '../components/Skeleton'
import { useWriteFeedback } from '../hooks/useWriteFeedback'

const emptySchoolYearForm = { label: '', startDate: '', endDate: '' }
// `semester` starts unset. Three quarters do not divide evenly into two
// semesters, so there is nothing to pre-fill it from — only the school knows
// where their boundary falls. An unset quarter is read as belonging to both,
// so leaving it blank never hides a grade.
const emptyPeriodForm = { name: '', sequenceNumber: '', startDate: '', endDate: '', semester: '' }

// Admin-only Academic Setup page. School years and grading periods are
// managed together deliberately — a grading period only makes sense in the
// context of one school year, so picking a year above and managing its
// quarters below (rather than two separate pages) matches how an admin
// actually thinks about this data. Neither entity supports deactivation:
// see the is-active migration's comment for why — a school year simply
// becomes not-current, and every table referencing either one is already
// protected from accidental removal by its own foreign key.
export function SchoolYearsPage() {
  // The principal reads these pages and changes nothing on them, so every
  // write control below is hidden rather than left to fail with a 403 the
  // page would show as a bare permission error.
  const { user } = useAuth()
  const canWrite = canManageAcademicSetup(user?.role)

  const [schoolYears, setSchoolYears] = useState([])
  const [loadingYears, setLoadingYears] = useState(true)
  const [showYearForm, setShowYearForm] = useState(false)
  const [editingYearId, setEditingYearId] = useState(null)
  const [yearForm, setYearForm] = useState(emptySchoolYearForm)

  // Failures, confirmations and the in-flight guard for all three writes on
  // this page. Confirmations matter most here: "Set current" changes which
  // school year the whole app reads by default, and used to report that by
  // refetching a table whose only visible difference is one pill.
  const { error, setError, notice, busyKey, runWrite } = useWriteFeedback()

  const [selectedYearId, setSelectedYearId] = useState('')
  const [periods, setPeriods] = useState([])
  const [loadingPeriods, setLoadingPeriods] = useState(false)
  const [showPeriodForm, setShowPeriodForm] = useState(false)
  const [editingPeriodId, setEditingPeriodId] = useState(null)
  const [periodForm, setPeriodForm] = useState(emptyPeriodForm)

  function loadSchoolYears() {
    setLoadingYears(true)
    api
      .get('/school-years')
      .then((data) => {
        setSchoolYears(data.schoolYears)
        if (!selectedYearId && data.schoolYears.length > 0) {
          const current = data.schoolYears.find((sy) => sy.is_current) || data.schoolYears[0]
          setSelectedYearId(String(current.id))
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingYears(false))
  }
  useEffect(loadSchoolYears, [setError])

  function loadPeriods() {
    if (!selectedYearId) {
      setPeriods([])
      return
    }
    setLoadingPeriods(true)
    api
      .get(`/grading-periods/admin?schoolYearId=${selectedYearId}`)
      .then((data) => setPeriods(data.gradingPeriods))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingPeriods(false))
  }
  useEffect(loadPeriods, [selectedYearId, setError])

  function startCreateYear() {
    setEditingYearId(null)
    setYearForm(emptySchoolYearForm)
    setShowYearForm(true)
  }

  function startEditYear(sy) {
    setEditingYearId(sy.id)
    setYearForm({ label: sy.label, startDate: sy.start_date, endDate: sy.end_date })
    setShowYearForm(true)
  }

  async function handleYearSubmit(e) {
    e.preventDefault()
    const wasEdit = Boolean(editingYearId)
    await runWrite(
      'year-form',
      async () => {
        if (editingYearId) {
          await api.put(`/school-years/${editingYearId}`, yearForm)
        } else {
          await api.post('/school-years', yearForm)
        }
        setShowYearForm(false)
        loadSchoolYears()
      },
      `School year ${yearForm.label} ${wasEdit ? 'updated' : 'created'}.`
    )
  }

  async function handleSetCurrent(sy) {
    await runWrite(
      `set-current-${sy.id}`,
      async () => {
        await api.post(`/school-years/${sy.id}/set-current`)
        loadSchoolYears()
      },
      // Spelled out rather than "Saved", because this one write changes what
      // every other page in the app treats as the current year.
      `${sy.label} is now the current school year.`
    )
  }

  function startCreatePeriod() {
    setEditingPeriodId(null)
    const nextSeq = periods.length > 0 ? Math.max(...periods.map((p) => p.sequence_number)) + 1 : 1
    setPeriodForm({ ...emptyPeriodForm, sequenceNumber: String(nextSeq) })
    setShowPeriodForm(true)
  }

  function startEditPeriod(p) {
    setEditingPeriodId(p.id)
    setPeriodForm({
      name: p.name,
      sequenceNumber: String(p.sequence_number),
      startDate: p.start_date,
      endDate: p.end_date,
      semester: p.semester == null ? '' : String(p.semester),
    })
    setShowPeriodForm(true)
  }

  async function handlePeriodSubmit(e) {
    e.preventDefault()
    const wasEdit = Boolean(editingPeriodId)
    const payload = {
      schoolYearId: Number(selectedYearId),
      name: periodForm.name,
      sequenceNumber: Number(periodForm.sequenceNumber),
      startDate: periodForm.startDate,
      endDate: periodForm.endDate,
      semester: periodForm.semester,
    }
    await runWrite(
      'period-form',
      async () => {
        if (editingPeriodId) {
          await api.put(`/grading-periods/${editingPeriodId}`, payload)
        } else {
          await api.post('/grading-periods', payload)
        }
        setShowPeriodForm(false)
        loadPeriods()
      },
      `${payload.name} ${wasEdit ? 'updated' : 'created'}.`
    )
  }

  const currentYear = schoolYears.find((sy) => sy.is_current)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Academic Setup' }, { label: 'School Years' }]} />

      <div className="page-header">
        <h1>School Years &amp; Grading Periods</h1>
        <div className="page-header__actions">
          {canWrite && (
            <button type="button" className="btn-primary" onClick={startCreateYear}>
              <Plus size={16} strokeWidth={1.75} />
              New School Year
            </button>
          )}
        </div>
      </div>

      <StatRow>
        <StatCard icon={CalendarRange} value={schoolYears.length} label="School years" />
        <StatCard icon={Star} value={currentYear ? currentYear.label : '—'} label="Current school year" variant="info" />
      </StatRow>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {showYearForm && (
        <form onSubmit={handleYearSubmit} className="intervention-log-form">
          <h3>{editingYearId ? 'Edit School Year' : 'New School Year'}</h3>
          <div className="intervention-log-form__fields">
            <label>Label</label>
            <input
              value={yearForm.label}
              onChange={(e) => setYearForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. 2027-2028"
              required
            />
            <label>Start Date</label>
            <input
              type="date"
              value={yearForm.startDate}
              onChange={(e) => setYearForm((f) => ({ ...f, startDate: e.target.value }))}
              required
            />
            <label>End Date</label>
            <input
              type="date"
              value={yearForm.endDate}
              onChange={(e) => setYearForm((f) => ({ ...f, endDate: e.target.value }))}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="submit" className="btn-primary" disabled={busyKey === 'year-form'}>
              {busyKey === 'year-form' ? 'Saving…' : editingYearId ? 'Save Changes' : 'Create School Year'}
            </button>
            <button type="button" onClick={() => setShowYearForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loadingYears ? (
        <SkeletonTable rows={4} columns={5} />
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schoolYears.map((sy) => (
                <tr
                  key={sy.id}
                  className="is-clickable-row"
                  onClick={() => setSelectedYearId(String(sy.id))}
                  style={selectedYearId === String(sy.id) ? { background: 'var(--color-primary-light)' } : undefined}
                >
                  <td>{sy.label}</td>
                  <td>{sy.start_date}</td>
                  <td>{sy.end_date}</td>
                  <td>{sy.is_current && <StatusPill label="current" variant="info" />}</td>
                  <td>
                    {/* Inline rather than a row menu, and so easy to miss
                        when hiding write controls — a read-only principal
                        must get neither. */}
                    {canWrite && (
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          type="button"
                          className="btn-subtle"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEditYear(sy)
                          }}
                        >
                          <Pencil size={13} strokeWidth={1.75} /> Edit
                        </button>
                        {!sy.is_current && (
                          <button
                            type="button"
                            className="btn-subtle"
                            disabled={busyKey === `set-current-${sy.id}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSetCurrent(sy)
                            }}
                          >
                            <Star size={13} strokeWidth={1.75} />
                            {busyKey === `set-current-${sy.id}` ? 'Setting…' : 'Set current'}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="record-section">
        <div className="record-section__header-row">
          <h2>
            Grading Periods
            {selectedYearId && schoolYears.find((sy) => String(sy.id) === selectedYearId) && (
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                {' '}
                — {schoolYears.find((sy) => String(sy.id) === selectedYearId).label}
              </span>
            )}
          </h2>
          {selectedYearId && canWrite && (
            <button type="button" className="btn-primary" onClick={startCreatePeriod}>
              <Plus size={16} strokeWidth={1.75} />
              New Grading Period
            </button>
          )}
        </div>

        {showPeriodForm && (
          <form onSubmit={handlePeriodSubmit} className="intervention-log-form">
            <h3>{editingPeriodId ? 'Edit Grading Period' : 'New Grading Period'}</h3>
            <div className="intervention-log-form__fields">
              <label>Name</label>
              <input
                value={periodForm.name}
                onChange={(e) => setPeriodForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Q1"
                required
              />
              <label>Sequence Number</label>
              <input
                type="number"
                min="1"
                value={periodForm.sequenceNumber}
                onChange={(e) => setPeriodForm((f) => ({ ...f, sequenceNumber: e.target.value }))}
                required
              />
              <label>Start Date</label>
              <input
                type="date"
                value={periodForm.startDate}
                onChange={(e) => setPeriodForm((f) => ({ ...f, startDate: e.target.value }))}
                required
              />
              <label>End Date</label>
              <input
                type="date"
                value={periodForm.endDate}
                onChange={(e) => setPeriodForm((f) => ({ ...f, endDate: e.target.value }))}
                required
              />
              {/* Set by hand, because it cannot be derived: three quarters do
                  not split evenly into two semesters, so where the boundary
                  falls is the school's decision, not arithmetic. */}
              <label htmlFor="period-semester">Semester</label>
              <select
                id="period-semester"
                value={periodForm.semester}
                onChange={(e) => setPeriodForm((f) => ({ ...f, semester: e.target.value }))}
              >
                <option value="">Not set</option>
                <option value="1">First semester</option>
                <option value="2">Second semester</option>
              </select>
              <p className="form-note" style={{ gridColumn: '1 / -1', margin: 0 }}>
                This decides which subjects appear in this quarter: a class that runs for one semester only shows up in
                that semester&rsquo;s quarters. Leave it unset and every class shows in this quarter.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button type="submit" className="btn-primary" disabled={busyKey === 'period-form'}>
                {busyKey === 'period-form' ? 'Saving…' : editingPeriodId ? 'Save Changes' : 'Create Grading Period'}
              </button>
              <button type="button" onClick={() => setShowPeriodForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {!selectedYearId ? (
          <div className="empty-state">
            <p>Select a school year above to manage its grading periods.</p>
          </div>
        ) : loadingPeriods ? (
          <SkeletonTable rows={3} columns={5} />
        ) : periods.length === 0 ? (
          <div className="empty-state">
            <p>No grading periods yet for this school year.</p>
          </div>
        ) : (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Semester</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td>{p.sequence_number}</td>
                    <td>{p.name}</td>
                    <td>{p.start_date}</td>
                    <td>{p.end_date}</td>
                    {/* "Not set" rather than a dash: a blank is a decision
                        the admin has not made yet, and the word says so. */}
                    <td>{p.semester ? `Semester ${p.semester}` : <span className="is-empty-value">Not set</span>}</td>
                    <td>
                      {canWrite && (
                        <button type="button" className="btn-subtle" onClick={() => startEditPeriod(p)}>
                          <Pencil size={13} strokeWidth={1.75} /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
