import { useEffect, useState } from 'react'
import { Plus, CalendarRange, Star, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'

const emptySchoolYearForm = { label: '', startDate: '', endDate: '' }
const emptyPeriodForm = { name: '', sequenceNumber: '', startDate: '', endDate: '' }

// Admin-only Academic Setup page. School years and grading periods are
// managed together deliberately — a grading period only makes sense in the
// context of one school year, so picking a year above and managing its
// quarters below (rather than two separate pages) matches how an admin
// actually thinks about this data. Neither entity supports deactivation:
// see the is-active migration's comment for why — a school year simply
// becomes not-current, and every table referencing either one is already
// protected from accidental removal by its own foreign key.
export function SchoolYearsPage() {
  const [schoolYears, setSchoolYears] = useState([])
  const [loadingYears, setLoadingYears] = useState(true)
  const [error, setError] = useState(null)
  const [showYearForm, setShowYearForm] = useState(false)
  const [editingYearId, setEditingYearId] = useState(null)
  const [yearForm, setYearForm] = useState(emptySchoolYearForm)
  const [savingYear, setSavingYear] = useState(false)

  const [selectedYearId, setSelectedYearId] = useState('')
  const [periods, setPeriods] = useState([])
  const [loadingPeriods, setLoadingPeriods] = useState(false)
  const [showPeriodForm, setShowPeriodForm] = useState(false)
  const [editingPeriodId, setEditingPeriodId] = useState(null)
  const [periodForm, setPeriodForm] = useState(emptyPeriodForm)
  const [savingPeriod, setSavingPeriod] = useState(false)

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
  useEffect(loadSchoolYears, [])

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
  useEffect(loadPeriods, [selectedYearId])

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
    setError(null)
    setSavingYear(true)
    try {
      if (editingYearId) {
        await api.put(`/school-years/${editingYearId}`, yearForm)
      } else {
        await api.post('/school-years', yearForm)
      }
      setShowYearForm(false)
      loadSchoolYears()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingYear(false)
    }
  }

  async function handleSetCurrent(sy) {
    setError(null)
    try {
      await api.post(`/school-years/${sy.id}/set-current`)
      loadSchoolYears()
    } catch (err) {
      setError(err.message)
    }
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
    })
    setShowPeriodForm(true)
  }

  async function handlePeriodSubmit(e) {
    e.preventDefault()
    setError(null)
    setSavingPeriod(true)
    const payload = {
      schoolYearId: Number(selectedYearId),
      name: periodForm.name,
      sequenceNumber: Number(periodForm.sequenceNumber),
      startDate: periodForm.startDate,
      endDate: periodForm.endDate,
    }
    try {
      if (editingPeriodId) {
        await api.put(`/grading-periods/${editingPeriodId}`, payload)
      } else {
        await api.post('/grading-periods', payload)
      }
      setShowPeriodForm(false)
      loadPeriods()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingPeriod(false)
    }
  }

  const currentYear = schoolYears.find((sy) => sy.is_current)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Academic Setup' }, { label: 'School Years' }]} />

      <div className="page-header">
        <h1>School Years &amp; Grading Periods</h1>
        <div className="page-header__actions">
          <button type="button" className="btn-primary" onClick={startCreateYear}>
            <Plus size={16} strokeWidth={1.75} />
            New School Year
          </button>
        </div>
      </div>

      <StatRow>
        <StatCard icon={CalendarRange} value={schoolYears.length} label="School years" />
        <StatCard icon={Star} value={currentYear ? currentYear.label : '—'} label="Current school year" variant="info" />
      </StatRow>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

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
            <button type="submit" className="btn-primary" disabled={savingYear}>
              {savingYear ? 'Saving…' : editingYearId ? 'Save Changes' : 'Create School Year'}
            </button>
            <button type="button" onClick={() => setShowYearForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loadingYears ? (
        <p>Loading…</p>
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
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSetCurrent(sy)
                          }}
                        >
                          <Star size={13} strokeWidth={1.75} /> Set current
                        </button>
                      )}
                    </div>
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
          {selectedYearId && (
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
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button type="submit" className="btn-primary" disabled={savingPeriod}>
                {savingPeriod ? 'Saving…' : editingPeriodId ? 'Save Changes' : 'Create Grading Period'}
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
          <p>Loading…</p>
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
                    <td>
                      <button type="button" className="btn-subtle" onClick={() => startEditPeriod(p)}>
                        <Pencil size={13} strokeWidth={1.75} /> Edit
                      </button>
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
