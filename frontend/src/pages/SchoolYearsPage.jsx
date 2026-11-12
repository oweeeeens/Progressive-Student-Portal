import { useEffect, useState } from 'react'
import { Plus, CalendarRange, Star, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { canManageAcademicSetup } from '../utils/permissions'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { Modal } from '../components/Modal'
import { SkeletonTable } from '../components/Skeleton'
import { useConfirm } from '../hooks/useConfirm'
import { useWriteFeedback } from '../hooks/useWriteFeedback'

const emptySchoolYearForm = { label: '', startDate: '', endDate: '' }
// `sequenceNumber` is the term's position in the year, and it carries real
// weight beyond ordering the table: a class offering that runs for one term
// names it as 'term1'/'term2'/'term3', and that is matched against this
// number (see utils/academicTerms.js). Term 2 is the period numbered 2.
const emptyPeriodForm = { name: '', sequenceNumber: '', startDate: '', endDate: '' }

// Admin-only Academic Setup page. School years and grading periods are
// managed together deliberately — a grading period only makes sense in the
// context of one school year, so picking a year above and managing its
// terms below (rather than two separate pages) matches how an admin
// actually thinks about this data. Neither entity supports deactivation:
// see the is-active migration's comment for why — a school year simply
// becomes not-current, and every table referencing either one is already
// protected from accidental removal by its own foreign key.
// What these two figures mean — and in the current year's case, what it
// silently decides everywhere else.
//
// "Current school year" looks like a label and behaves like a switch: almost
// every other page in the app resolves "this year" through it. Someone
// changing it to fix a display on this page would be repointing attendance,
// grade entry and risk scoring at the same time, so that consequence is
// stated here rather than discovered.
function schoolYearStatDetails(schoolYears, currentYear) {
  // `schoolYears` is null when the read was refused — this page 403s for
  // every role except admin and principal. "Could not be read" and "there
  // are none" are different claims and only one is ever true, so the
  // unreadable case gets its own wording rather than an explanation of a
  // zero that was never measured.
  const unreadable = schoolYears === null

  return {
    years: {
      title: 'School years',
      subtitle: unreadable ? 'Not available' : schoolYears.length,
      definition: unreadable
        ? 'This could not be read. Academic Setup is restricted to admin and the principal, so the figure above is unknown rather than zero.'
        : 'Every school year set up in the system, past and present.',
      rules: unreadable
        ? [
            'Nothing is wrong with the data — you simply do not have permission to read it, and a blank is the honest answer where a 0 would be a false one.',
          ]
        : [
            'Years are never deleted — grades, attendance and sections all reference the year they belong to, so removing one would orphan the records underneath it.',
            'Each year owns its own grading periods, and a period’s sequence number is unique only WITHIN its year. That is why a learner’s second year in the school does not collide with their first.',
          ],
    },
    current: {
      title: 'Current school year',
      subtitle: unreadable ? 'Not available' : currentYear ? currentYear.label : 'Not set',
      definition: unreadable
        ? 'This could not be read, so which year the rest of the app treats as “now” is unknown from here — not unset.'
        : currentYear
          ? `${currentYear.label} is the year every other page treats as “now”.`
          : 'No year is marked current, so pages that resolve “this year” have nothing to resolve it to.',
      rules: unreadable
        ? ['Academic Setup is admin and principal only. The rest of the app still resolves “this year” normally; you just cannot see or change which year that is from here.']
        : [
            'This is a switch, not a label. Attendance, grade entry, the class and section pickers, and risk scoring all resolve “this year” through it.',
            'Exactly one year can be current. Setting another one takes the flag off this one in the same action.',
            'Changing it mid-year repoints the whole app, including which sections and class offerings teachers are offered. It is not a display setting.',
          ],
      footnote: unreadable
        ? undefined
        : currentYear
          ? 'Which grading period is “now” within this year is decided separately, by today’s date against each period’s start and end — using the school’s own timezone, not the server’s.'
          : 'Until one is set, mark a year current from the table below.',
    },
  }
}

export function SchoolYearsPage() {
  // The principal reads these pages and changes nothing on them, so every
  // write control below is hidden rather than left to fail with a 403 the
  // page would show as a bare permission error.
  const { user } = useAuth()
  const canWrite = canManageAcademicSetup(user?.role)

  // null until the server answers, NOT []. A failed read — this page 403s
  // for every role except admin and principal — otherwise left the stat card
  // asserting "0 School years" directly beside "You do not have permission
  // to do this." StatCard already renders null as an em dash for exactly
  // this reason; it just needed to be given one.
  const [schoolYears, setSchoolYears] = useState(null)
  const [loadingYears, setLoadingYears] = useState(true)
  const [showYearForm, setShowYearForm] = useState(false)
  const [editingYearId, setEditingYearId] = useState(null)
  const [yearForm, setYearForm] = useState(emptySchoolYearForm)

  // Failures, confirmations and the in-flight guard for all three writes on
  // this page. Confirmations matter most here: "Set current" changes which
  // school year the whole app reads by default, and used to report that by
  // refetching a table whose only visible difference is one pill.
  const { error, setError, busyKey, runWrite } = useWriteFeedback()
  const [confirm, confirmDialog] = useConfirm()
  const { openFor, close: closeStat, cardProps } = useStatExplainer('schoolyear-stat-detail')

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
      .catch((err) => {
        setError(err.message)
        // Drop the previously selected year's periods: they used to stay
        // listed under the newly chosen year, beside the error.
        setPeriods([])
      })
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
    // One click here changes what the whole System treats as "this year".
    const current = (schoolYears || []).find((y) => y.is_current)
    const ok = await confirm({
      title: `Make ${sy.label} the current school year?`,
      message: `${current ? `${current.label} will no longer be the current year. ` : ''}Everywhere the System works from the current school year will use ${sy.label} from now on.`,
      confirmLabel: `Make ${sy.label} current`,
    })
    if (!ok) return
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

  const currentYear = schoolYears?.find((sy) => sy.is_current)

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
        <StatCard
          icon={CalendarRange}
          value={schoolYears ? schoolYears.length : null}
          label="School years"
          {...cardProps('years')}
        />
        <StatCard
          icon={Star}
          value={currentYear ? currentYear.label : '—'}
          label="Current school year"
          variant="info"
          {...cardProps('current')}
        />
      </StatRow>

      <StatDetail
        id="schoolyear-stat-detail"
        detail={schoolYearStatDetails(schoolYears, currentYear)[openFor()]}
        onClose={closeStat}
      />

      {error && <Alert>{error}</Alert>}

      <Modal
        open={showYearForm}
        onClose={() => setShowYearForm(false)}
        title={editingYearId ? 'Edit School Year' : 'New School Year'}
      >
        <form onSubmit={handleYearSubmit} className="intervention-log-form">
          <div className="intervention-log-form__fields">
            <label htmlFor="year-label">Label<span className="required-mark"> *</span></label>
            <input id="year-label"
              value={yearForm.label}
              onChange={(e) => setYearForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. 2027-2028"
              required
            />
            <label htmlFor="year-start-date">Start Date<span className="required-mark"> *</span></label>
            <input id="year-start-date"
              type="date"
              value={yearForm.startDate}
              onChange={(e) => setYearForm((f) => ({ ...f, startDate: e.target.value }))}
              required
            />
            <label htmlFor="year-end-date">End Date<span className="required-mark"> *</span></label>
            <input id="year-end-date"
              type="date"
              value={yearForm.endDate}
              onChange={(e) => setYearForm((f) => ({ ...f, endDate: e.target.value }))}
              required
            />
          </div>
          <div className="button-row">
            <button type="submit" className="btn-primary" disabled={busyKey === 'year-form'}>
              {busyKey === 'year-form' ? 'Saving…' : editingYearId ? 'Save Changes' : 'Create School Year'}
            </button>
            <button type="button" onClick={() => setShowYearForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

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
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(schoolYears || []).map((sy) => (
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
                      <div className="button-row button-row--tight">
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
            {selectedYearId && schoolYears?.find((sy) => String(sy.id) === selectedYearId) && (
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

        <Modal
          open={showPeriodForm}
          onClose={() => setShowPeriodForm(false)}
          title={editingPeriodId ? 'Edit Grading Period' : 'New Grading Period'}
        >
          <form onSubmit={handlePeriodSubmit} className="intervention-log-form">
            <div className="intervention-log-form__fields">
              <label htmlFor="period-name">Name<span className="required-mark"> *</span></label>
              <input id="period-name"
                value={periodForm.name}
                onChange={(e) => setPeriodForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Q1"
                required
              />
              <label htmlFor="period-sequence-number">Sequence Number<span className="required-mark"> *</span></label>
              <input id="period-sequence-number"
                type="number"
                min="1"
                value={periodForm.sequenceNumber}
                onChange={(e) => setPeriodForm((f) => ({ ...f, sequenceNumber: e.target.value }))}
                required
              />
              <label htmlFor="period-start-date">Start Date<span className="required-mark"> *</span></label>
              <input id="period-start-date"
                type="date"
                value={periodForm.startDate}
                onChange={(e) => setPeriodForm((f) => ({ ...f, startDate: e.target.value }))}
                required
              />
              <label htmlFor="period-end-date">End Date<span className="required-mark"> *</span></label>
              <input id="period-end-date"
                type="date"
                value={periodForm.endDate}
                onChange={(e) => setPeriodForm((f) => ({ ...f, endDate: e.target.value }))}
                required
              />
              {/* The sequence number is not just sort order, so the form
                  says so: a class set to run for "Term 2 only" appears in
                  the period numbered 2 and nowhere else. */}
              <p className="form-note">
                The sequence number decides which classes appear here. A class set to run for a single term shows up in
                the term with that number &mdash; Term 2 only means the period numbered 2.
              </p>
            </div>
            <div className="button-row">
              <button type="submit" className="btn-primary" disabled={busyKey === 'period-form'}>
                {busyKey === 'period-form' ? 'Saving…' : editingPeriodId ? 'Save Changes' : 'Create Grading Period'}
              </button>
              <button type="button" onClick={() => setShowPeriodForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>

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
                  <th>
                  <span className="sr-only">Actions</span>
                </th>
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
      {confirmDialog}
    </div>
  )
}
