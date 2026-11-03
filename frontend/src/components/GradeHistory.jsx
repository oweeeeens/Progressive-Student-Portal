import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import { LineChart } from './charts/LineChart'
import { ChartCard } from './charts/ChartCard'
import { DataTable, fieldValue } from './table/DataTable'
import { Alert } from './Alert'
import { SkeletonTable } from './Skeleton'
import { CLASS_TERM_SHORT } from '../utils/academicTerms'

// The four statuses a grade can actually hold, as the approval chain
// defines them: submitted → principal_verified → finalized, plus rejected.
//
// This map still listed `draft`, a status removed when the chain was
// introduced, and named only two of the four — so three of the four pills
// rendered with an undefined variant, which is to say unstyled. A status
// badge whose colour is missing is worse than plain text: it looks like the
// one state nobody bothered to give a meaning.
//
// The colours are the non-risk status palette, never the risk ramp — a grade
// awaiting verification is not an at-risk student (see CLAUDE.md).
const STATUS_VARIANTS = {
  submitted: 'info',
  principal_verified: 'warning',
  finalized: 'positive',
  rejected: 'negative',
}

// The stored values carry underscores; a reader should not have to.
const STATUS_LABELS = {
  submitted: 'Submitted',
  principal_verified: 'Verified by principal',
  finalized: 'Finalized',
  rejected: 'Returned to teacher',
}

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
  if (!grades) return <SkeletonTable rows={4} columns={5} />

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

              <DataTable illustration="grades"
          columns={[
            { key: 'subject', header: 'Subject', render: (g) => g.subject_name },
            { key: 'period', header: 'Period', render: (g) => g.grading_period_name },
            {
              key: 'term',
              header: 'Runs for',
              // Quiet for a whole-year class, which is every Grade 11 class
              // — so the column only speaks up for a subject that stops at
              // the semester, which is the thing a reader would otherwise
              // have to go to Academic Setup to find out.
              uniformValue: (g) => g.term,
              quietValue: 'full_year',
              render: (g) => CLASS_TERM_SHORT[g.term] || fieldValue(g.term),
            },
            { key: 'grade', header: 'Grade', align: 'right', render: (g) => fieldValue(g.grade_value) },
            {
              key: 'status',
              header: 'Status',
              uniformValue: (g) => g.status,
              render: (g) => (
                <StatusPill label={STATUS_LABELS[g.status] || g.status} variant={STATUS_VARIANTS[g.status] || 'neutral'} />
              ),
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
