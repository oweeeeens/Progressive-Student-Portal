import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import { GradeSparkline } from './GradeSparkline'

const STATUS_VARIANTS = { draft: 'warning', finalized: 'positive' }

export function GradeHistory({ studentId }) {
  const [grades, setGrades] = useState(null)
  const [periodAverages, setPeriodAverages] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .get(`/students/${studentId}/grades`)
      .then((data) => {
        setGrades(data.grades)
        setPeriodAverages(data.periodAverages || [])
      })
      .catch((err) => setError(err.message))
  }, [studentId])

  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>
  if (!grades) return <p>Loading…</p>

  return (
    <div className="record-section">
      <h2>Grades</h2>

      {periodAverages.length >= 2 && (
        <div className="grade-sparkline-wrap">
          <GradeSparkline
            points={periodAverages.map((p) => ({ label: `Period ${p.sequence_number}`, value: Number(p.average_grade) }))}
          />
          <span className="grade-sparkline-wrap__label">
            Average grade across {periodAverages.length} finalized periods
          </span>
        </div>
      )}

      {grades.length === 0 ? (
        <div className="empty-state">
          <p>No grades recorded yet.</p>
          <p>Grades appear here once a subject teacher enters them for this student.</p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Subject</th>
                <th>Grade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td>{g.grading_period_name}</td>
                  <td>{g.subject_name}</td>
                  <td>{g.grade_value}</td>
                  <td>
                    <StatusPill label={g.status} variant={STATUS_VARIANTS[g.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
