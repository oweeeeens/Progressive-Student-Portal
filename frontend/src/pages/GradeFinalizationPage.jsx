import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../api/client'
import { defaultSelection } from '../utils/defaultSelection'
import { useGradingPeriods } from '../hooks/useGradingPeriods'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import './GradesShared.css'
import { formatGrade } from '../utils/formatNumber'
import { Alert } from '../components/Alert'
import { SpotIllustration } from '../components/illustrations/SpotIllustration'
import { DataTable, fieldValue } from '../components/table/DataTable'

// The final stage of CLAUDE.md's 3-stage grade approval chain, done by
// whoever actually advises the section (sections.adviser_id, not whoever's
// role is literally 'adviser'): see every principal-verified grade (any
// subject) for that section in one period, then finalize the whole batch
// at once. Finalizing is what makes these grades count toward risk scoring.
//
// Unlike Verify Grades, there is no per-grade finalize here: the backend
// endpoint (gradeModel.finalizeSectionGrades) finalizes every
// principal-verified grade for a section+period in one statement — there's
// no per-grade-id variant, and adding one is out of scope for a layout/UX
// pass (per-grade verify/reject stays exactly as it was). The checkboxes
// below are deliberately framed as a review aid, not a selection that
// narrows what gets finalized — a button that looked row-scoped but
// silently finalized everyone would be actively misleading.
export function GradeFinalizationPage() {
  const { user } = useAuth()
  const [sections, setSections] = useState([])
  const [sectionId, setSectionId] = useState('')
  // Opens on the period the school is in, so an adviser with verified grades
  // waiting lands on them instead of on an empty "pick a section and grading
  // period" state with the work one click away.
  const { periods, gradingPeriodId, setGradingPeriodId, error: periodsError } = useGradingPeriods()
  const [verifiedGrades, setVerifiedGrades] = useState([])
  // Where this section's other grades are in the approval chain, so an empty
  // list can say WHY it is empty (see gradeModel.countStatusesForSectionPeriod).
  const [pipeline, setPipeline] = useState(null)
  const [sectionsError, setSectionsError] = useState(null)
  const [reviewedIds, setReviewedIds] = useState(new Set())
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [finalizing, setFinalizing] = useState(false)

  // admin has blanket finalize access by role (the only role that bypasses
  // the adviser_id ownership check — see gradeController.finalizeGrades),
  // so admin gets every section to choose from; everyone else is scoped to
  // sections they actually advise, not just whoever is literally labeled
  // 'adviser' — that column doesn't have to match the role column.
  useEffect(() => {
    const scopedToMe = user.role !== 'admin'
    const path = scopedToMe ? '/sections/mine' : '/sections'
    api
      .get(path)
      .then((data) => {
        setSections(data.sections)
        setSectionId((current) => current || defaultSelection(data.sections, scopedToMe))
      })
      // Without this an empty picker sat beside "Pick a section", and a
      // failed request read as having no sections at all.
      .catch((err) => setSectionsError(`Couldn't load the section list: ${err.message}`))
  }, [user.role])

  function loadVerifiedGrades() {
    // Cleared before every request, not only on success: a failed load used
    // to leave the previous section's grades listed under the new section's
    // name, with the Finalize button still live.
    setVerifiedGrades([])
    setPipeline(null)
    setReviewedIds(new Set())
    if (!sectionId || !gradingPeriodId) return
    setError(null)
    setLoading(true)
    api
      .get(`/grades/pending?sectionId=${sectionId}&gradingPeriodId=${gradingPeriodId}`)
      .then((data) => {
        setVerifiedGrades(data.verified)
        setPipeline(data.pipeline || null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(loadVerifiedGrades, [sectionId, gradingPeriodId])

  function toggleRow(id) {
    setReviewedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setReviewedIds((prev) => (prev.size === verifiedGrades.length ? new Set() : new Set(verifiedGrades.map((g) => g.id))))
  }

  async function handleFinalize() {
    setError(null)
    setMessage(null)
    setFinalizing(true)
    try {
      const result = await api.post('/grades/finalize', {
        sectionId: Number(sectionId),
        gradingPeriodId: Number(gradingPeriodId),
      })
      setMessage(`Finalized grades for ${result.finalizedCount} entries. Risk scores have been recalculated.`)
      loadVerifiedGrades()
    } catch (err) {
      setError(err.message)
    } finally {
      setFinalizing(false)
    }
  }

  const ready = Boolean(sectionId && gradingPeriodId)
  const sectionLabel = (() => {
    const s = sections.find((x) => String(x.id) === String(sectionId))
    return s ? `Grade ${s.grade_level} – ${s.name}` : 'this section'
  })()
  const periodLabel = periods.find((p) => String(p.id) === String(gradingPeriodId))?.name || 'this period'

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Grades' }, { label: 'Finalize' }]} />

      <div className="page-header">
        <h1>Finalize Grades</h1>
        <div className="page-header__actions">
          <label>
            Section
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">-- select --</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Grade {s.grade_level} - {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grading Period
            <select value={gradingPeriodId} onChange={(e) => setGradingPeriodId(e.target.value)}>
              <option value="">-- select --</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {sectionsError && <Alert>{sectionsError}</Alert>}
      {periodsError && <Alert>{periodsError}</Alert>}
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

      {!ready ? (
        <div className="empty-state">
          <SpotIllustration name="grades" />
          <p>Pick a section and grading period.</p>
          <p>Grades the principal has verified appear here, ready to go into the official record.</p>
        </div>
      ) : (
        <>
          {verifiedGrades.length > 0 && (
          <>
          {/* Same consolidation as Verify Grades: the tile above this line
              repeated the count the line already carried. */}
          <p className="live-summary-bar">
            <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="live-summary-bar__lead">{verifiedGrades.length} ready to finalize</span>
            {reviewedIds.size > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--color-success)' }}>{reviewedIds.size} reviewed</span>
              </>
            )}
          </p>
          <p className="help-text mb-3">
            Checking a row marks it reviewed — finalizing always applies to every grade below at once.
          </p>
          </>
          )}

          {/* Always rendered once a section and period are chosen. It used to
              sit inside the `verifiedGrades.length > 0` block above, so its
              loading skeleton and its empty state could never appear: picking
              a section with nothing to finalize left the page blank. */}
          <DataTable
            loading={loading}
            illustration="cleared"
            columns={[
              {
                key: 'student',
                header: 'Student',
                primary: true,
                plainText: (g) => `${g.last_name}, ${g.first_name}`,
                render: (g) => `${g.last_name}, ${g.first_name}`,
              },
              { key: 'subject', header: 'Subject', uniformValue: (g) => g.subject_name, render: (g) => g.subject_name },
              {
                key: 'grade',
                header: 'Grade',
                // Right-aligned: this is the last look anyone gets before
                // these marks become the official record, so the digits
                // need to line up.
                align: 'right',
                render: (g) => formatGrade(g.grade_value),
              },
              {
                key: 'recorded',
                header: 'Recorded by',
                truncate: true,
                uniformValue: (g) => g.recorded_by_name,
                plainText: (g) => g.recorded_by_name,
                render: (g) => fieldValue(g.recorded_by_name),
              },
              {
                key: 'verified',
                header: 'Verified by',
                truncate: true,
                uniformValue: (g) => g.verified_by_name,
                plainText: (g) => g.verified_by_name,
                render: (g) => fieldValue(g.verified_by_name),
              },
            ]}
            rows={verifiedGrades}
            rowKey={(g) => g.id}
            selection={{
              selectedIds: reviewedIds,
              onToggleRow: toggleRow,
              onToggleAll: toggleAll,
              label: 'Mark all reviewed',
            }}
            error={error}
            emptyState={
              <FinalizeEmptyState
                sectionLabel={sectionLabel}
                periodLabel={periodLabel}
                pipeline={pipeline}
                canVerify={user.role === 'admin' || user.role === 'principal'}
              />
            }
          />

          {verifiedGrades.length > 0 && (
          <div className="sticky-action-bar">
            <span className="sticky-action-bar__status">
              {reviewedIds.size} of {verifiedGrades.length} reviewed
            </span>
            <button type="button" className="btn-primary" onClick={handleFinalize} disabled={finalizing}>
              {finalizing
                ? 'Finalizing…'
                : `Finalize all ${verifiedGrades.length} ${verifiedGrades.length === 1 ? 'grade' : 'grades'}`}
            </button>
          </div>
          )}
        </>
      )}
    </div>
  )
}

// Why there is nothing to finalize, in the words of the approval chain.
// "Nothing here" alone is the same sentence whether twelve grades are still
// with the principal, three were sent back, or the whole term is already in
// the record — and those call for three different next steps.
function FinalizeEmptyState({ sectionLabel, periodLabel, pipeline, canVerify }) {
  const lines = []
  if (pipeline) {
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
    if (pipeline.submitted > 0) {
      lines.push(`${plural(pipeline.submitted, 'grade is', 'grades are')} with the principal for verification.`)
    }
    if (pipeline.rejected > 0) {
      lines.push(`${plural(pipeline.rejected, 'grade was', 'grades were')} returned to the subject teacher to correct.`)
    }
    if (pipeline.finalized > 0) {
      lines.push(`${plural(pipeline.finalized, 'grade is', 'grades are')} already finalized in the official record.`)
    }
    if (lines.length === 0) lines.push('No grades have been submitted for this section in this period yet.')
  }
  return (
    <>
      <p>
        Nothing waiting to be finalized for {sectionLabel} in {periodLabel}.
      </p>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {canVerify && pipeline?.submitted > 0 && (
        <p>
          <Link to="/grades/verify">Go to Verify Grades</Link>
        </p>
      )}
    </>
  )
}
