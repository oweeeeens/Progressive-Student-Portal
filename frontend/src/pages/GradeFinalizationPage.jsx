import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import './GradesShared.css'

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
  const [periods, setPeriods] = useState([])
  const [sectionId, setSectionId] = useState('')
  const [gradingPeriodId, setGradingPeriodId] = useState('')
  const [verifiedGrades, setVerifiedGrades] = useState([])
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
    const path = user.role === 'admin' ? '/sections' : '/sections/mine'
    api.get(path).then((data) => setSections(data.sections))
    api.get('/grading-periods').then((data) => setPeriods(data.gradingPeriods))
  }, [user.role])

  function loadVerifiedGrades() {
    if (!sectionId || !gradingPeriodId) {
      setVerifiedGrades([])
      return
    }
    setError(null)
    setLoading(true)
    api
      .get(`/grades/pending?sectionId=${sectionId}&gradingPeriodId=${gradingPeriodId}`)
      .then((data) => {
        setVerifiedGrades(data.verified)
        setReviewedIds(new Set())
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

      <StatRow>
        <StatCard icon={CheckCircle2} value={verifiedGrades.length} label="Ready to finalize" variant="info" />
      </StatRow>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--color-success)' }}>{message}</p>}

      {!ready ? (
        <div className="empty-state">
          <p>Select a section and grading period to review verified grades ready to finalize.</p>
        </div>
      ) : loading ? (
        <p>Loading…</p>
      ) : verifiedGrades.length === 0 ? (
        <div className="empty-state">
          <p>No principal-verified grades awaiting finalization for this section/period.</p>
        </div>
      ) : (
        <>
          <p className="live-summary-bar">
            <span style={{ color: 'var(--color-text)' }}>{verifiedGrades.length} ready to finalize</span>
            {' · '}
            <span style={{ color: 'var(--color-success)' }}>{reviewedIds.size} reviewed</span>
          </p>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)', margin: '0 0 var(--space-3)' }}>
            Checking a row marks it reviewed — finalizing always applies to every grade below at once.
          </p>

          <div className="table-card">
            <table className="grade-review-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={reviewedIds.size === verifiedGrades.length}
                      onChange={toggleAll}
                      aria-label="Mark all reviewed"
                      title="Mark all reviewed"
                    />
                  </th>
                  <th>Student</th>
                  <th>Subject</th>
                  <th>Grade</th>
                  <th>Recorded by</th>
                  <th>Verified by</th>
                </tr>
              </thead>
              <tbody>
                {verifiedGrades.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={reviewedIds.has(g.id)}
                        onChange={() => toggleRow(g.id)}
                        aria-label={`Mark ${g.first_name} ${g.last_name} - ${g.subject_name} reviewed`}
                        title="Mark reviewed"
                      />
                    </td>
                    <td>
                      {g.last_name}, {g.first_name}
                    </td>
                    <td>{g.subject_name}</td>
                    <td>{g.grade_value}</td>
                    <td>{g.recorded_by_name}</td>
                    <td>{g.verified_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sticky-action-bar">
            <span className="sticky-action-bar__status">
              {reviewedIds.size} of {verifiedGrades.length} reviewed
            </span>
            <button type="button" className="btn-primary" onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? 'Finalizing…' : `Finalize all ${verifiedGrades.length} grade(s)`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
