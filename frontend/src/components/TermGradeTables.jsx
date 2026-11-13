import { ArrowUp, ArrowDown } from 'lucide-react'
import { DataTable } from './table/DataTable'
import { StatusPill } from './StatusPill'
import { offeringCoversPeriod, SUBJECT_CATEGORY_LABELS } from '../utils/academicTerms'
import { GRADE_STATUS_NOTES, GRADE_STATUS_LABELS, GRADE_STATUS_VARIANTS, finalizedAverageForPeriod } from '../utils/gradeMatrix'
import { useGradeBreakdown } from './GradeBreakdown'

// One learner's grades as ONE TABLE PER TERM, stacked Term 1 → Term 3.
//
// Used by both grade views in the System: the staff Grades tab on a
// student's record (GradeHistory) and the learner's own My Grades page. The
// staff view used to print every grade in one list with Term 2 and Term 1
// rows interleaved, and the student view hid each term behind a tab; stacked
// tables let either reader see every term at once and compare them down the
// page, without the period being a column they have to sort by eye.
//
// Which subjects belong in a term is decided per row (utils/academicTerms.js,
// mirroring the server): a Grade 12 class that runs for one term appears only
// in that term, a whole-year or specialized subject in all three.


// Props:
//   gradingPeriods  — the school year's terms, any order (sorted here)
//   rows            — from utils/gradeMatrix.buildGradeMatrix
//   passingGrade    — marks below it render red; null hides the legend
//   showStatus      — staff view: a Status column with the approval-chain
//                     pill. The student view instead notes "In review" under
//                     any mark that is not yet official.
//   currentPeriodId — the term the school is in today, tagged as such
//   error           — the request behind the rows failed
export function TermGradeTables({ gradingPeriods, rows, passingGrade, showStatus = false, currentPeriodId = null, error }) {
  const periods = [...gradingPeriods].sort((a, b) => a.sequence_number - b.sequence_number)
  // One breakdown dialog for every grade in every term table.
  const [showBreakdown, breakdownDialog] = useGradeBreakdown()

  if (periods.length === 0) {
    return (
      <div className="empty-state">
        <p>No grading periods are set up for this school year yet.</p>
        <p>Grades appear here, one table per term, once the terms exist.</p>
      </div>
    )
  }

  return (
    <div className="term-grades">
      {periods.map((period, index) => {
        const termRows = rows.filter((row) =>
          offeringCoversPeriod({
            term: row.term,
            subjectCategory: row.category,
            periodSequenceNumber: period.sequence_number,
          })
        )
        return (
          <TermBlock
            key={period.id}
            period={period}
            previousPeriod={periods[index - 1] || null}
            rows={termRows}
            passingGrade={passingGrade}
            showStatus={showStatus}
            isCurrent={period.id === currentPeriodId}
            error={error}
            showBreakdown={showBreakdown}
          />
        )
      })}
      {/* One legend for all three tables, under the stack. Passed to the
          last DataTable it rendered above Term 3 and read as if it applied
          to that term alone. */}
      {passingGrade != null && (
        <p className="help-text">
          Marks below the passing grade of {passingGrade} are shown in red. Only a finalized mark is official and counts
          towards an average. Select a mark to see how it was computed.
        </p>
      )}
      {breakdownDialog}
    </div>
  )
}

// One term: its heading (name, finalized average, how many subjects have a
// mark) and its table.
function TermBlock({ period, previousPeriod, rows, passingGrade, showStatus, isCurrent, error, showBreakdown }) {
  const average = finalizedAverageForPeriod(rows, period.id)
  const markedCount = rows.filter((r) => r.cells[period.id]).length
  const headingId = `term-grades-${period.id}`

  // The meta line says only what the data supports: an average only when
  // something is finalized, and how many of the term's subjects have a mark
  // so far — "4 of 7 graded" is how a reader knows the term is still open.
  const meta = []
  if (average != null) meta.push(`Average ${average}`)
  if (rows.length > 0) meta.push(`${markedCount} of ${rows.length} subject${rows.length === 1 ? '' : 's'} graded`)

  const columns = [
    {
      key: 'subject',
      header: 'Subject',
      primary: true,
      plainText: (r) => r.subjectName,
      render: (r) => (
        <>
          <span className="cell-primary">{r.subjectName}</span>
          {r.teacherName && <span className="cell-secondary">{r.teacherName}</span>}
        </>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      // Quiet while every subject is core, which is most of them — so the
      // column only appears for the specialized subject that is the reason
      // it runs in every term.
      uniformValue: (r) => r.category,
      quietValue: 'core',
      render: (r) => SUBJECT_CATEGORY_LABELS[r.category] || '—',
    },
    {
      key: 'grade',
      header: 'Grade',
      align: 'right',
      render: (r) => {
        const cell = r.cells[period.id]
        if (!cell) return <span className="grade-cell__empty">—</span>
        const below = passingGrade != null && cell.value < passingGrade
        const note = showStatus ? null : GRADE_STATUS_NOTES[cell.status]
        return (
          <>
            {/* The grade opens the arithmetic it was computed from — the
                adviser's point that a grade must show its breakdown. */}
            <button
              type="button"
              className={`link-button cell-primary${below ? ' is-below' : ''}`}
              title="How this grade was computed"
              onClick={() => showBreakdown(`${r.subjectName} — ${period.name}`, cell.computation, cell.value)}
            >
              {cell.value.toFixed(2)}
            </button>
            {note && <span className="cell-secondary">{note}</span>}
          </>
        )
      },
    },
    // How this subject moved since the term before — the one question a
    // reader brings to a single subject. FINALIZED marks on both sides only:
    // comparing a mark still in review would show a movement that is not yet
    // real. The first term has nothing before it, so no column.
    ...(previousPeriod
      ? [
          {
            key: 'change',
            header: `vs ${previousPeriod.name}`,
            align: 'right',
            render: (r) => {
              const now = r.cells[period.id]
              const before = r.cells[previousPeriod.id]
              if (now?.status !== 'finalized' || before?.status !== 'finalized') {
                return <span className="grade-cell__empty">—</span>
              }
              const delta = Math.round((now.value - before.value) * 10) / 10
              if (delta === 0) return <span className="cell-secondary">no change</span>
              const Icon = delta > 0 ? ArrowUp : ArrowDown
              return (
                <span className={`grade-change grade-change--${delta > 0 ? 'up' : 'down'}`}>
                  <Icon size={14} strokeWidth={2} aria-hidden="true" />
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              )
            },
          },
        ]
      : []),
    ...(showStatus
      ? [
          {
            key: 'status',
            header: 'Status',
            render: (r) => {
              const cell = r.cells[period.id]
              if (!cell) return <span className="cell-secondary">Not yet entered</span>
              return (
                <StatusPill
                  label={GRADE_STATUS_LABELS[cell.status] || cell.status}
                  variant={GRADE_STATUS_VARIANTS[cell.status] || 'neutral'}
                />
              )
            },
          },
        ]
      : []),
  ]

  return (
    <section className="term-grades__block" aria-labelledby={headingId}>
      <div className="term-grades__head">
        <h3 id={headingId}>{period.name}</h3>
        {isCurrent && <span className="term-grades__tag">Current term</span>}
        {meta.length > 0 && <span className="term-grades__meta">{meta.join(' · ')}</span>}
      </div>
      <DataTable
        illustration="grades"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.subjectId}
        error={error}
        emptyState={
          <>
            <p>No grades recorded for {period.name} yet.</p>
            <p>A class that runs for a single term appears in that term only.</p>
          </>
        }
      />
    </section>
  )
}
