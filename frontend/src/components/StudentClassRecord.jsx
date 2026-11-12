import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Alert } from './Alert'
import { SkeletonTable } from './Skeleton'
import { StatusPill } from './StatusPill'
import { useGradeBreakdown } from './GradeBreakdown'

// One learner's complete class record: for every term, every subject, the
// score on each quiz, task and exam out of its highest possible score, the
// percentage per component, and the grade those scores compute to.
//
// This is the "full information" the research adviser asked to see on a
// learner's record — the grade is no longer a bare number, the scores it
// came from are right beside it. Used on the staff Student Detail page and
// on the learner's own My Grades. Data: GET /students/:id/class-record,
// scoped on the server exactly like the learner's grades.

const STATUS_LABELS = { submitted: 'Submitted', principal_verified: 'Principal-verified', rejected: 'Returned to teacher', finalized: 'Finalized' }
const STATUS_VARIANTS = { submitted: 'warning', principal_verified: 'info', rejected: 'negative', finalized: 'positive' }
const fmt = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))
const num = (v) => (Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2))

// The scores of one component as compact chips, with the component's PS.
function ComponentCell({ items, component }) {
  if (!items.length) return <span className="text-muted">—</span>
  return (
    <div className="student-cr__cell">
      <div className="student-cr__chips">
        {items.map((item) => (
          <span key={item.id} className={`student-cr__chip${item.rawScore === null ? ' is-missing' : ''}`} title={item.title}>
            {item.rawScore === null ? '—' : num(item.rawScore)}/{num(item.highestPossibleScore)}
          </span>
        ))}
      </div>
      {component && <span className="student-cr__ps">{component.percentageScore === null ? 'incomplete' : `${fmt(component.percentageScore)}%`}</span>}
    </div>
  )
}

export function StudentClassRecord({ studentId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [showBreakdown, breakdownDialog] = useGradeBreakdown()

  useEffect(() => {
    setData(null)
    setError(null)
    api
      .get(`/students/${studentId}/class-record`)
      .then(setData)
      .catch((err) => setError(err.message))
  }, [studentId])

  if (error) return <Alert>Couldn&apos;t load the class record: {error}</Alert>
  if (!data) return <SkeletonTable rows={5} columns={6} />
  if (data.subjects.length === 0) {
    return (
      <div className="empty-state">
        <p>No classes for this learner yet.</p>
        <p>Scores appear here once the learner&apos;s section has class offerings and teachers record them.</p>
      </div>
    )
  }

  const periods = [...data.gradingPeriods].sort((a, b) => a.sequence_number - b.sequence_number)
  return (
    <div className="student-cr">
      {periods.map((period) => {
        const rows = data.subjects.filter((s) => s.terms[period.id])
        if (rows.length === 0) return null
        const anyScores = rows.some((s) => s.terms[period.id].items.length > 0)
        return (
          <section key={period.id} className="student-cr__term">
            <h3>
              {period.name}
              {period.id === data.currentPeriodId && <span className="pill pill--info student-cr__current">Current term</span>}
            </h3>
            {!anyScores ? (
              <p className="help-text">No scores recorded for {period.name} yet.</p>
            ) : (
              <div className="table-card student-cr__scroll">
                <table className="student-cr__table">
                  <thead>
                    <tr>
                      <th scope="col">Subject</th>
                      <th scope="col">Written/Oral Works</th>
                      <th scope="col">Performance Tasks</th>
                      <th scope="col">Examinations</th>
                      <th scope="col" className="is-right">Initial grade</th>
                      <th scope="col" className="is-right">Term grade</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((subject) => {
                      const term = subject.terms[period.id]
                      const byComponent = (key) => term.items.filter((i) => i.component === key)
                      const comp = (key) => term.computed?.components.find((c) => c.key === key)
                      const official = term.grade
                      const shown = official ? official.value : term.computed?.termGrade ?? null
                      const below = shown !== null && shown < data.passingGrade
                      return (
                        <tr key={subject.classOfferingId}>
                          <th scope="row">
                            {subject.subjectName}
                            {subject.teacherName && <span className="student-cr__teacher">{subject.teacherName}</span>}
                          </th>
                          <td><ComponentCell items={byComponent('ww')} component={comp('ww')} /></td>
                          <td><ComponentCell items={byComponent('pt')} component={comp('pt')} /></td>
                          <td><ComponentCell items={byComponent('ex')} component={comp('ex')} /></td>
                          <td className="is-right">{fmt(term.computed?.initialGrade)}</td>
                          <td className="is-right">
                            {shown === null ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <button
                                type="button"
                                className={`link-button student-cr__grade${below ? ' is-below' : ''}`}
                                title="How this grade was computed"
                                onClick={() =>
                                  showBreakdown(
                                    `${subject.subjectName} — ${period.name}`,
                                    official ? official.computation : term.computed,
                                    official ? official.value : undefined
                                  )
                                }
                              >
                                {shown}
                              </button>
                            )}
                          </td>
                          <td>
                            {official ? (
                              <StatusPill label={STATUS_LABELS[official.status] || official.status} variant={STATUS_VARIANTS[official.status]} />
                            ) : term.provisional ? (
                              <span className="student-cr__provisional">Provisional — not yet submitted</span>
                            ) : term.items.length > 0 ? (
                              <span className="text-muted">Scores incomplete</span>
                            ) : (
                              <span className="text-muted">No scores yet</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
      <p className="help-text">
        Each score is shown out of its highest possible score. Grades are computed from these scores as prescribed by
        DepEd Order No. 015, s. 2026; only a finalized grade is official. Select a grade to see the arithmetic.
      </p>
      {breakdownDialog}
    </div>
  )
}
