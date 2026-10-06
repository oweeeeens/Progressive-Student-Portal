import { Fragment, useEffect, useState } from 'react'
import { ShieldCheck, ShieldX, ClipboardCheck } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import './GradesShared.css'

const PAGE_SIZE = 20

// The principal's review step — the middle stage of CLAUDE.md's 3-stage
// grade approval chain. Unlike the adviser's queue (one advisory section)
// this is school-wide: there is only one principal for the whole school, so
// the queue spans every section/subject for the chosen grading period, with
// an optional section filter to keep a large queue manageable. Verifying
// moves a grade to 'principal_verified' (the adviser can then finalize it);
// rejecting sends it back to the subject teacher with a required note —
// always a per-row action (never bulk): a reason has to actually describe
// the one submission it's rejecting, so batching it would just produce a
// generic note that doesn't help the teacher fix anything specific.
export function VerifyGradesPage() {
  const [periods, setPeriods] = useState([])
  const [sections, setSections] = useState([])
  const [gradingPeriodId, setGradingPeriodId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionNote, setRejectionNote] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    api.get('/grading-periods/current').then((data) => {
      if (data.gradingPeriod) {
        // /grading-periods/current only returns name/schoolYearLabel, not an
        // id — load the full list and match by name to default the picker.
        api.get('/grading-periods').then((periodsData) => {
          setPeriods(periodsData.gradingPeriods)
          const current = periodsData.gradingPeriods.find((p) => p.name === data.gradingPeriod.name)
          if (current) setGradingPeriodId(String(current.id))
        })
      } else {
        api.get('/grading-periods').then((periodsData) => setPeriods(periodsData.gradingPeriods))
      }
    })
    api.get('/sections').then((data) => setSections(data.sections))
  }, [])

  function loadQueue() {
    if (!gradingPeriodId) {
      setRows([])
      setTotal(0)
      return
    }
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ gradingPeriodId, page, pageSize: PAGE_SIZE })
    if (sectionId) params.set('sectionId', sectionId)
    api
      .get(`/grades/submitted?${params.toString()}`)
      .then((data) => {
        setRows(data.rows)
        setTotal(data.total)
        setSelectedIds(new Set())
        setRejectingId(null)
        setRejectionNote('')
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(loadQueue, [gradingPeriodId, sectionId, page])

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))
  }

  async function verifyGradeIds(gradeIds) {
    setError(null)
    setMessage(null)
    setActing(true)
    try {
      const result = await api.post('/grades/verify', { gradeIds })
      setMessage(`Verified ${result.verifiedCount} grade(s). The adviser can now finalize them.`)
      loadQueue()
    } catch (err) {
      setError(err.message)
    } finally {
      setActing(false)
    }
  }

  function startReject(id) {
    setRejectingId(id)
    setRejectionNote('')
  }

  async function handleReject(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setActing(true)
    try {
      const result = await api.post('/grades/reject', { gradeIds: [rejectingId], note: rejectionNote })
      setMessage(`Rejected ${result.rejectedCount} grade(s). The subject teacher will see your note and can resubmit.`)
      loadQueue()
    } catch (err) {
      setError(err.message)
    } finally {
      setActing(false)
    }
  }

  const pending = total - selectedIds.size
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Grades' }, { label: 'Verify' }]} />

      <div className="page-header">
        <h1>Verify Grades</h1>
        <div className="page-header__actions">
          <label>
            Grading Period
            <select
              value={gradingPeriodId}
              onChange={(e) => {
                setPage(1)
                setGradingPeriodId(e.target.value)
              }}
            >
              <option value="">-- select --</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Section
            <select
              value={sectionId}
              onChange={(e) => {
                setPage(1)
                setSectionId(e.target.value)
              }}
            >
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Grade {s.grade_level} - {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <StatRow>
        <StatCard icon={ClipboardCheck} value={total} label="Awaiting review" variant="warning" />
      </StatRow>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--color-success)' }}>{message}</p>}

      {!gradingPeriodId ? (
        <div className="empty-state">
          <p>Select a grading period to review submitted grades.</p>
        </div>
      ) : loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No submitted grades awaiting review.</p>
        </div>
      ) : (
        <>
          <p className="live-summary-bar">
            <span style={{ color: 'var(--color-success)' }}>{selectedIds.size} selected to verify</span>
            {' · '}
            <span style={{ color: 'var(--color-text-muted)' }}>{pending} pending</span>
          </p>

          <div className="table-card">
            <table className="grade-review-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === rows.length}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th>Student</th>
                  <th>Section</th>
                  <th>Subject</th>
                  <th>Grade</th>
                  <th>Submitted by</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleRow(r.id)}
                          aria-label={`Select ${r.first_name} ${r.last_name} - ${r.subject_name}`}
                        />
                      </td>
                      <td>
                        {r.last_name}, {r.first_name}
                      </td>
                      <td>
                        Grade {r.grade_level} - {r.section_name}
                      </td>
                      <td>{r.subject_name}</td>
                      <td>{r.grade_value}</td>
                      <td>{r.recorded_by_name}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          <button
                            type="button"
                            className="btn-subtle"
                            onClick={() => verifyGradeIds([r.id])}
                            disabled={acting}
                          >
                            <ShieldCheck size={13} strokeWidth={1.75} /> Verify
                          </button>
                          <button
                            type="button"
                            className="btn-subtle"
                            onClick={() => startReject(r.id)}
                            disabled={acting}
                          >
                            <ShieldX size={13} strokeWidth={1.75} /> Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                    {rejectingId === r.id && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <form onSubmit={handleReject} className="grade-reject-form">
                            <textarea
                              value={rejectionNote}
                              onChange={(e) => setRejectionNote(e.target.value)}
                              required
                              rows={2}
                              placeholder={`Why is ${r.first_name} ${r.last_name}'s ${r.subject_name} grade being rejected?`}
                              autoFocus
                            />
                            <div className="grade-reject-form__actions">
                              <button type="submit" className="btn-danger" disabled={acting}>
                                {acting ? 'Rejecting…' : 'Confirm reject'}
                              </button>
                              <button type="button" onClick={() => setRejectingId(null)} disabled={acting}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}

          <div className="sticky-action-bar">
            <span className="sticky-action-bar__status">{selectedIds.size} selected</span>
            <button
              type="button"
              className="btn-primary"
              onClick={() => verifyGradeIds([...selectedIds])}
              disabled={selectedIds.size === 0 || acting}
            >
              <ShieldCheck size={16} strokeWidth={1.75} />
              Verify selected
            </button>
          </div>
        </>
      )}
    </div>
  )
}
