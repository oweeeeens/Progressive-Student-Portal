import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { LineChart } from './charts/LineChart'
import { ChartCard } from './charts/ChartCard'
import { Alert } from './Alert'
import { SkeletonTable } from './Skeleton'
import { TermGradeTables } from './TermGradeTables'
import { buildGradeMatrix } from '../utils/gradeMatrix'

// The Grades tab on a student's record — what admin, registrar, principal,
// adviser, guidance counselor and subject teacher see (each under their own
// read scope, enforced server-side).
//
// One table per term, stacked. This was a single list with Term 2 and Term 1
// rows interleaved and the period as a column, so comparing a learner's two
// terms meant reading the same subject twice in different parts of the table.
// The shared TermGradeTables is also what the learner's own My Grades page
// uses, so both readers see the marks grouped identically.
export function GradeHistory({ studentId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .get(`/students/${studentId}/grades`)
      .then(setData)
      .catch((err) => setError(err.message))
  }, [studentId])

  const rows = useMemo(() => (data ? buildGradeMatrix({ grades: data.grades }) : []), [data])

  // The chart's points are named after the school's own terms ("Term 1"),
  // matched by sequence number, rather than a generic "Period 1".
  const chartPoints = useMemo(() => {
    if (!data) return []
    const nameBySequence = new Map((data.gradingPeriods || []).map((p) => [p.sequence_number, p.name]))
    return (data.periodAverages || []).map((p) => ({
      label: nameBySequence.get(p.sequence_number) || `Period ${p.sequence_number}`,
      value: Number(p.average_grade),
    }))
  }, [data])

  if (error) return <Alert>{error}</Alert>
  if (!data) return <SkeletonTable rows={4} columns={4} />

  return (
    <div className="record-section">
      <h2>Grades</h2>

      {chartPoints.length >= 2 && (
        <div className="mb-5">
          <ChartCard title="Average Grade Over Time" description={`Across ${chartPoints.length} finalized grading periods.`}>
            <LineChart
              points={chartPoints}
              formatValue={(v) => String(Math.round(v * 10) / 10)}
              yMin={60}
              yMax={100}
              axisNote="Vertical axis starts at 60, not 0 — the DepEd reporting range."
            />
          </ChartCard>
        </div>
      )}

      {data.grades.length === 0 ? (
        <div className="empty-state">
          <p>No grades recorded yet.</p>
          <p>Grades appear here, one table per term, once a subject teacher enters them for this student.</p>
        </div>
      ) : (
        <TermGradeTables
          gradingPeriods={data.gradingPeriods || []}
          rows={rows}
          passingGrade={data.passingGrade ?? null}
          currentPeriodId={data.currentPeriodId ?? null}
          showStatus
        />
      )}
    </div>
  )
}
