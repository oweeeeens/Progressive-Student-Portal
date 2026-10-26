import { useEffect, useMemo, useState } from 'react'
import { FileDown, GraduationCap, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatCard, StatRow } from '../components/StatCard'
import { GradeStatExplainer } from '../components/GradeStatExplainer'
import { StatusPill } from '../components/StatusPill'
import { ChartCard } from '../components/charts/ChartCard'
import { ChangeBarChart } from '../components/charts/ChangeBarChart'
import { DataTable } from '../components/table/DataTable'
import { useOwnStudentRecord } from '../hooks/useOwnStudentRecord'

// The student's grades, on their own page: the report-card matrix, the
// per-subject comparison for the current period, and the printable PDF.
//
// Split out of the home page once that page had grown to roughly four
// screens. Home keeps what a student needs at a glance — the figures, the
// advice, the trends — and the detail they came looking for on purpose
// lives here, one click away rather than four scrolls down.

// How official a grade record is, used to pick ONE value per subject/period
// cell when a period holds several (a rejected submission and the entry
// that replaced it). Higher wins.
const GRADE_STATUS_RANK = { rejected: 0, submitted: 1, principal_verified: 2, finalized: 3 }
// Only a finalized mark is the official record (CLAUDE.md's approval
// workflow), so anything earlier in the pipeline is labelled rather than
// printed as if it were final.
const GRADE_STATUS_NOTES = { submitted: 'In review', principal_verified: 'In review', rejected: 'Returned to teacher' }
// One panel serves all four figures, so one id covers every card's
// aria-controls — they all point at the same region.
const GRADE_EXPLAINER_ID = 'grade-stat-explainer'

// One sentence about the movement above: the subject that moved most against
// the student if anything fell, otherwise the best news available.
function describeMovement(changes) {
  if (changes.length === 0) return null
  const worst = changes[0]
  const best = changes[changes.length - 1]
  if (worst.value < 0) {
    return `${worst.label} fell the most, by ${Math.abs(worst.value)} points. ${
      best.value > 0 ? `${best.label} rose ${best.value}.` : 'Nothing rose this period.'
    }`
  }
  if (best.value > 0) return `Everything held or improved — ${best.label} rose the most, by ${best.value} points.`
  return 'Every subject held exactly steady.'
}

// A subject's full history, opened from its row: every period's mark with the
// status attached, so an in-review mark is visibly not yet official, plus who
// to ask about it.
function SubjectDetail({ row, periods }) {
  const marks = periods.map((period) => ({ period, cell: row.cells[period.name] })).filter((m) => m.cell)

  return (
    <div className="subject-detail">
      <dl className="field-grid">
        <div>
          <dt>Teacher</dt>
          <dd>{row.teacherName || 'No teacher assigned'}</dd>
        </div>
        <div>
          <dt>Average of finalized marks</dt>
          <dd>{row.average == null ? '—' : row.average}</dd>
        </div>
      </dl>

      {marks.length === 0 ? (
        <p className="form-note">No marks recorded for this subject yet.</p>
      ) : (
        <ul className="subject-detail__marks">
          {marks.map(({ period, cell }) => (
            <li key={period.id}>
              <span className="subject-detail__period">{period.name}</span>
              <span className="subject-detail__mark">{cell.value}</span>
              <StatusPill
                label={cell.status}
                variant={cell.status === 'finalized' ? 'positive' : cell.status === 'rejected' ? 'negative' : 'info'}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function StudentGradesPage() {
  const { student, loading: loadingStudent, error: studentError } = useOwnStudentRecord()
  const [subjects, setSubjects] = useState(null)
  const [subjectGrades, setSubjectGrades] = useState(null)
  const [grades, setGrades] = useState(null)
  const [gradingPeriods, setGradingPeriods] = useState([])
  const [error, setError] = useState(null)
  const [reportCardError, setReportCardError] = useState(null)
  const [downloadingReportCard, setDownloadingReportCard] = useState(false)
  // Which subject's history is open. One at a time, the same detail-on-demand
  // pattern Interventions and Academic Progress already use.
  const [expandedSubject, setExpandedSubject] = useState(null)
  // Which summary figure is currently explaining itself, or null.
  const [openStat, setOpenStat] = useState(null)

  // The student-scoped endpoints carry no :id — they resolve the caller's
  // own record server-side (see backend/controllers/myProgressController.js).
  useEffect(() => {
    Promise.all([
      api.get('/my-progress/subjects'),
      api.get('/my-progress/subject-grades'),
      api.get('/grading-periods'),
    ])
      .then(([subjectList, perSubject, periods]) => {
        setSubjects(subjectList)
        setSubjectGrades(perSubject)
        setGradingPeriods(periods.gradingPeriods)
      })
      .catch((err) => setError(err.message))
  }, [])

  // The full grade history needs the student's id, so it waits for the record.
  useEffect(() => {
    if (!student) return
    api
      .get(`/students/${student.id}/grades`)
      .then((data) => setGrades(data.grades))
      .catch((err) => setError(err.message))
  }, [student])

  const passingGrade = subjects?.passingGrade ?? subjectGrades?.passingGrade ?? null

  // One row per subject, one cell per grading period — the report-card shape
  // the school already uses on paper. Rows start from the class list so a
  // subject with no mark yet still appears (its absence is information too),
  // and any subject with a mark but no active offering is added rather than
  // dropped.
  const gradeMatrix = useMemo(() => {
    const rows = new Map()
    for (const s of subjects?.subjects || []) {
      rows.set(s.subjectName, { subjectName: s.subjectName, teacherName: s.teacherName, cells: {} })
    }
    for (const g of grades || []) {
      if (!rows.has(g.subject_name)) {
        rows.set(g.subject_name, { subjectName: g.subject_name, teacherName: null, cells: {} })
      }
      const row = rows.get(g.subject_name)
      const existing = row.cells[g.grading_period_name]
      if (!existing || GRADE_STATUS_RANK[g.status] > GRADE_STATUS_RANK[existing.status]) {
        row.cells[g.grading_period_name] = { value: Number(g.grade_value), status: g.status }
      }
    }
    return [...rows.values()].map((row) => {
      // Finalized marks only — the same official-record rule the risk
      // formula uses, so this average and the one on the home page can
      // never disagree.
      const finalized = Object.values(row.cells).filter((c) => c.status === 'finalized')
      const average = finalized.length
        ? Math.round((finalized.reduce((sum, c) => sum + c.value, 0) / finalized.length) * 10) / 10
        : null
      return { ...row, average }
    })
  }, [subjects, grades])

  // How each subject MOVED between its last two finalized marks — the one
  // thing the table above cannot show without the reader doing arithmetic
  // across every row. A chart of this period's marks would only redraw the
  // table's own column.
  //
  // Biggest drop first: the subject that moved most against the student is
  // the one worth reading first, the same "most urgent at the top" ordering
  // the rest of the student view uses.
  const subjectChanges = useMemo(() => {
    const periodOrder = gradingPeriods.map((p) => p.name)
    return gradeMatrix
      .map((row) => {
        const marked = periodOrder
          .filter((name) => row.cells[name]?.status === 'finalized')
          .map((name) => ({ name, value: row.cells[name].value }))
        if (marked.length < 2) return null
        const latest = marked[marked.length - 1]
        const previous = marked[marked.length - 2]
        return {
          key: row.subjectName,
          label: row.subjectName,
          value: Math.round((latest.value - previous.value) * 10) / 10,
          detail: `${previous.name} ${previous.value} to ${latest.name} ${latest.value}`,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.value - b.value)
  }, [gradeMatrix, gradingPeriods])

  // The page's summary, built from ONE grading period's finalized marks —
  // the most recent period that has any, which is exactly the set the home
  // page's Average grade figure is built from. Averaging each subject's own
  // multi-period average instead would be just as defensible and would give
  // a different number, and a portal that reports two different "your
  // average" figures on two pages is a portal a student cannot trust.
  //
  // Highest and lowest only earn a card when there is more than one subject
  // to compare; with a single subject they are the same mark printed twice.
  const summary = useMemo(() => {
    const marks = subjectGrades?.subjects || []
    if (marks.length === 0) return null
    const total = marks.reduce((sum, m) => sum + m.grade, 0)
    const ranked = [...marks].sort((a, b) => b.grade - a.grade)
    return {
      periodName: subjectGrades.periodName,
      marks,
      average: Math.round((total / marks.length) * 10) / 10,
      belowPassing: passingGrade == null ? null : marks.filter((m) => m.grade < passingGrade).length,
      subjectCount: marks.length,
      best: marks.length > 1 ? ranked[0] : null,
      worst: marks.length > 1 ? ranked[ranked.length - 1] : null,
    }
  }, [subjectGrades, passingGrade])

  function toggleStat(key) {
    setOpenStat((current) => (current === key ? null : key))
  }

  // The same printable record the registrar can generate. The server builds
  // it from finalized grades and daily attendance, and its own scoping
  // guarantees a student can only ever reach their own.
  async function handleDownloadReportCard() {
    setReportCardError(null)
    setDownloadingReportCard(true)
    try {
      await api.downloadFile(
        `/students/${student.id}/report-card`,
        `${student.last_name}_${student.first_name}_ReportCard.pdf`
      )
    } catch (err) {
      setReportCardError(err.message)
    } finally {
      setDownloadingReportCard(false)
    }
  }

  if (loadingStudent) return <p>Loading your grades…</p>
  if (studentError) return <Alert>{studentError}</Alert>
  if (!student) {
    return (
      <div className="empty-state">
        <p>No student record is linked to this account.</p>
        <p>Ask the registrar to connect your login to your student record.</p>
      </div>
    )
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Grades' }]} />

      <div className="record-section__header-row">
        <h1>My Grades</h1>
        <button type="button" className="btn-subtle" onClick={handleDownloadReportCard} disabled={downloadingReportCard}>
          <FileDown size={14} strokeWidth={1.75} />
          {downloadingReportCard ? 'Preparing…' : 'Download report card'}
        </button>
      </div>

      {error && <Alert>{error}</Alert>}
      {reportCardError && <Alert>{reportCardError}</Alert>}

      {summary && (
        <>
          {/* Each figure opens its own working, the same way the home page's
              figures do — a summary number a student cannot interrogate is
              one they can only take on trust. */}
          <StatRow>
            <StatCard
              icon={GraduationCap}
              value={summary.average}
              label={`Average · ${summary.periodName}`}
              variant={passingGrade != null && summary.average < passingGrade ? 'negative' : undefined}
              onClick={() => toggleStat('average')}
              isExpanded={openStat === 'average'}
              controls={GRADE_EXPLAINER_ID}
            />
            {summary.belowPassing != null && (
              <StatCard
                icon={AlertTriangle}
                value={summary.belowPassing}
                label={`Below the passing grade of ${passingGrade}`}
                variant={summary.belowPassing > 0 ? 'negative' : 'positive'}
                onClick={() => toggleStat('belowPassing')}
                isExpanded={openStat === 'belowPassing'}
                controls={GRADE_EXPLAINER_ID}
              />
            )}
            {summary.best && (
              <StatCard
                icon={ArrowUp}
                value={summary.best.grade}
                label={`Highest · ${summary.best.subjectName}`}
                variant="positive"
                onClick={() => toggleStat('highest')}
                isExpanded={openStat === 'highest'}
                controls={GRADE_EXPLAINER_ID}
              />
            )}
            {summary.worst && (
              <StatCard
                icon={ArrowDown}
                value={summary.worst.grade}
                label={`Lowest · ${summary.worst.subjectName}`}
                variant="negative"
                onClick={() => toggleStat('lowest')}
                isExpanded={openStat === 'lowest'}
                controls={GRADE_EXPLAINER_ID}
              />
            )}
          </StatRow>

          {openStat && (
            <GradeStatExplainer
              id={GRADE_EXPLAINER_ID}
              statKey={openStat}
              periodName={summary.periodName}
              marks={summary.marks}
              passingGrade={passingGrade}
              onClose={() => setOpenStat(null)}
            />
          )}
        </>
      )}

      <div className="record-section">
        <h2>Your Subjects &amp; Grades</h2>
        <DataTable illustration="grades"
          columns={[
            {
              key: 'subject',
              header: 'Subject',
              render: (r) => (
                <>
                  <span className="cell-primary">{r.subjectName}</span>
                  <span className="cell-secondary">{r.teacherName || 'No teacher assigned'}</span>
                </>
              ),
            },
            ...gradingPeriods.map((period) => ({
              key: `period-${period.id}`,
              header: period.name,
              align: 'right',
              render: (r) => {
                const cell = r.cells[period.name]
                if (!cell) return <span className="grade-cell__empty">—</span>
                const note = GRADE_STATUS_NOTES[cell.status]
                return (
                  <>
                    <span className={`cell-primary${passingGrade != null && cell.value < passingGrade ? ' is-below' : ''}`}>
                      {cell.value}
                    </span>
                    {note && <span className="cell-secondary">{note}</span>}
                  </>
                )
              },
            })),
            {
              key: 'average',
              // Not just "Average": the figure in the summary above is also an
              // average, of a different thing (this period across subjects,
              // rather than this subject across periods). Naming the column
              // for what it actually covers is what stops the two numbers
              // reading as a contradiction.
              header: 'Subject average',
              align: 'right',
              render: (r) =>
                r.average == null ? (
                  <span className="grade-cell__empty">—</span>
                ) : (
                  <strong className={passingGrade != null && r.average < passingGrade ? 'is-below' : undefined}>
                    {r.average}
                  </strong>
                ),
            },
          ]}
          rows={gradeMatrix}
          rowKey={(r) => r.subjectName}
          error={error}
          onRowClick={(r) => setExpandedSubject((current) => (current === r.subjectName ? null : r.subjectName))}
          renderExpanded={(r) => (expandedSubject === r.subjectName ? <SubjectDetail row={r} periods={gradingPeriods} /> : null)}
          legend={
            passingGrade != null
              ? `Marks below the passing grade of ${passingGrade} are shown in red. Only finalized marks count towards the average — anything still in review is marked as such.`
              : null
          }
          emptyState={
            <>
              <p>No subjects on your record yet.</p>
              <p>Your subjects appear here once the registrar assigns you to a section with classes.</p>
            </>
          }
        />
      </div>

      <div className="record-section">
        <ChartCard
          title="Movement Since Last Period"
          description="How each subject changed between its last two finalized marks — biggest drop first."
          legend={[
            { label: 'Improved', color: 'var(--band-performing-well)' },
            { label: 'Dropped', color: 'var(--band-at-risk-high)' },
          ]}
          isEmpty={subjectChanges.length === 0}
          emptyMessage="Two grading periods of finalized marks are needed before movement can be shown."
          interpretation={describeMovement(subjectChanges)}
        >
          <ChangeBarChart rows={subjectChanges} />
        </ChartCard>
      </div>
    </div>
  )
}
