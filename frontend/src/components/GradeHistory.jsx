import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import { LineChart } from './charts/LineChart'
import { ChartCard } from './charts/ChartCard'
import { DataTable, fieldValue } from './table/DataTable'
import { Alert } from './Alert'

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

  if (error) return <Alert>{error}</Alert>
  if (!grades) return <p>Loading…</p>

  return (
    <div className="record-section">
      <h2>Grades</h2>

      {periodAverages.length >= 2 && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <ChartCard title="Average Grade Over Time" description={`Across ${periodAverages.length} finalized grading periods.`}>
            <LineChart
              points={periodAverages.map((p) => ({ label: `Period ${p.sequence_number}`, value: Number(p.average_grade) }))}
              formatValue={(v) => String(Math.round(v * 10) / 10)}
              yMin={60}
              yMax={100}
              axisNote="Vertical axis starts at 60, not 0 — the DepEd reporting range."
            />
          </ChartCard>
        </div>
      )}

              <DataTable
          columns={[
            { key: 'subject', header: 'Subject', render: (g) => g.subject_name },
            { key: 'period', header: 'Period', render: (g) => g.grading_period_name },
            { key: 'grade', header: 'Grade', align: 'right', render: (g) => fieldValue(g.grade_value) },
            {
              key: 'status',
              header: 'Status',
              uniformValue: (g) => g.status,
              render: (g) => <StatusPill label={g.status} variant={STATUS_VARIANTS[g.status]} />,
            },
          ]}
          rows={grades}
          rowKey={(g) => g.id}
          emptyState={
            <>
              <p>No grades recorded yet.</p>
              <p>Grades appear here once a subject teacher enters them for this student.</p>
            </>
          }
        />
    </div>
  )
}
