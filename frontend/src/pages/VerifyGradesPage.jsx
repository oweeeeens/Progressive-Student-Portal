import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldX, ClipboardCheck } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import './GradesShared.css'
import { formatGrade } from '../utils/formatNumber'
import { Alert } from '../components/Alert'
import { SpotIllustration } from '../components/illustrations/SpotIllustration'
import { DataTable, fieldValue } from '../components/table/DataTable'

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
      // The period the queue is filtered to travels with the action: the
      // server bounds the bulk update to it, so a verify can only ever touch
      // the batch on screen.
      const result = await api.post('/grades/verify', { gradeIds, gradingPeriodId: Number(gradingPeriodId) })
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
      const result = await api.post('/grades/reject', {
        gradeIds: [rejectingId],
        note: rejectionNote,
        gradingPeriodId: Number(gradingPeriodId),
      })
      setMessage(`Rejected ${result.rejectedCount} grade(s). The subject teacher will see your note and can resubmit.`)
      loadQueue()
    } catch (err) {
      setError(err.message)
    } finally {
      setActing(false)
    }
  }

  // How many grades are actually waiting — not minus the ones ticked.
  // Selecting a row is not reviewing it, and subtracting the selection made
  // the line read "0 awaiting your review" with twelve unreviewed grades on
  // screen. The selected count is stated separately right beside it.
  // (`total` is server-wide for the period; `selectedIds` is this page only,
  // so the old arithmetic mixed two different scopes as well.)
  const pending = total

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

      {error && <Alert>{error}</Alert>}
      {/* These four screens are where the real work of a school week gets
          done — a roster marked, a term's grades submitted, verified, put
          into the official record. Each used to answer with a bare green
          sentence, the exact pattern Alert was introduced to replace. */}
      {message && (
        <Alert variant="success" className="alert--settles">
          {message}
        </Alert>
      )}

      {!gradingPeriodId ? (
        <div className="empty-state">
          <SpotIllustration name="grades" />
          <p>Pick a grading period to review.</p>
          <p>Grades appear here as soon as a subject teacher submits them.</p>
        </div>
      ) : (
        <>
          {/* One place for the counts. A stat tile above this line used to
              print "Awaiting review" with the same number the line already
              ended on. */}
          {!loading && rows.length > 0 && (
          <p className="live-summary-bar">
            <ClipboardCheck size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="live-summary-bar__lead">{pending} awaiting your review</span>
            {selectedIds.size > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--color-success)' }}>{selectedIds.size} selected</span>
              </>
            )}
          </p>
          )}

          <DataTable
            loading={loading}
            illustration="cleared"
            columns={[
              {
                key: 'student',
                header: 'Student',
                primary: true,
                plainText: (r) => `${r.last_name}, ${r.first_name}`,
                render: (r) => `${r.last_name}, ${r.first_name}`,
              },
              {
                key: 'section',
                header: 'Section',
                uniformValue: (r) => `${r.grade_level}|${r.section_name}`,
                summaryText: (r) => `Grade ${r.grade_level} - ${r.section_name}`,
                render: (r) => `Grade ${r.grade_level} - ${r.section_name}`,
              },
              { key: 'subject', header: 'Subject', uniformValue: (r) => r.subject_name, render: (r) => r.subject_name },
              {
                key: 'grade',
                header: 'Grade',
                // Right-aligned so the digits form a column the eye can run
                // down. This screen exists to find marks below the passing
                // threshold, and left-aligned numbers put 71 and 100 at the
                // same starting x with the decimal somewhere different on
                // every row.
                align: 'right',
                render: (r) => formatGrade(r.grade_value),
              },
              {
                key: 'by',
                header: 'Submitted by',
                truncate: true,
                uniformValue: (r) => r.recorded_by_name,
                plainText: (r) => r.recorded_by_name,
                render: (r) => fieldValue(r.recorded_by_name),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            selection={{
              selectedIds,
              onToggleRow: toggleRow,
              onToggleAll: toggleAll,
              label: 'Select all grades on this page',
            }}
            rowActions={(r) => [
              { key: 'verify', label: 'Verify', icon: ShieldCheck, disabled: acting, onSelect: () => verifyGradeIds([r.id]) },
              { key: 'reject', label: 'Reject', icon: ShieldX, danger: true, disabled: acting, onSelect: () => startReject(r.id) },
            ]}
            renderExpanded={(r) =>
              rejectingId === r.id ? (
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
              ) : null
            }
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            emptyState={
              <>
                <p>Nothing waiting on you.</p>
                <p>Every grade submitted for this period has been reviewed.</p>
              </>
            }
          />


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
