import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'

// The adviser's review step: see every draft grade (any subject) for their
// advisory section in one period, then approve the whole batch at once.
// Finalizing is what makes these grades count toward risk scoring.
export function GradeFinalizationPage() {
  const { user } = useAuth()
  const [sections, setSections] = useState([])
  const [periods, setPeriods] = useState([])
  const [sectionId, setSectionId] = useState('')
  const [gradingPeriodId, setGradingPeriodId] = useState('')
  const [drafts, setDrafts] = useState([])
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [finalizing, setFinalizing] = useState(false)

  useEffect(() => {
    const path = user.role === 'adviser' ? '/sections/mine' : '/sections'
    api.get(path).then((data) => setSections(data.sections))
    api.get('/grading-periods').then((data) => setPeriods(data.gradingPeriods))
  }, [user.role])

  function loadDrafts() {
    if (!sectionId || !gradingPeriodId) {
      setDrafts([])
      return
    }
    setError(null)
    api
      .get(`/grades/pending?sectionId=${sectionId}&gradingPeriodId=${gradingPeriodId}`)
      .then((data) => setDrafts(data.drafts))
      .catch((err) => setError(err.message))
  }

  useEffect(loadDrafts, [sectionId, gradingPeriodId])

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
      loadDrafts()
    } catch (err) {
      setError(err.message)
    } finally {
      setFinalizing(false)
    }
  }

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

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--color-success)' }}>{message}</p>}

      {!sectionId || !gradingPeriodId ? (
        <div className="empty-state">
          <p>Select a section and grading period to review draft grades.</p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="empty-state">
          <p>No draft grades awaiting review for this section/period.</p>
        </div>
      ) : (
        <>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Subject</th>
                  <th>Grade</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.last_name}, {d.first_name}
                    </td>
                    <td>{d.subject_name}</td>
                    <td>{d.grade_value}</td>
                    <td>{d.recorded_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleFinalize}
            disabled={finalizing}
            style={{ marginTop: 'var(--space-4)' }}
          >
            {finalizing ? 'Finalizing…' : `Finalize all ${drafts.length} grade(s)`}
          </button>
        </>
      )}
    </div>
  )
}
