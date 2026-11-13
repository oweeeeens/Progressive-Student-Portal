import { useEffect, useMemo, useState } from 'react'
import { GraduationCap, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatCard, StatRow } from '../components/StatCard'
import { GradeStatExplainer } from '../components/GradeStatExplainer'
import { StatusPill } from '../components/StatusPill'
import { ChartCard } from '../components/charts/ChartCard'
import { ChangeBarChart } from '../components/charts/ChangeBarChart'
import { DataTable } from '../components/table/DataTable'
import { Tabs } from '../components/Tabs'
import { MyTermGrades } from '../components/MyTermGrades'
import { useGradeBreakdown } from '../components/GradeBreakdown'
import { SkeletonTable } from '../components/Skeleton'
import { buildGradeMatrix, GRADE_STATUS_NOTES } from '../utils/gradeMatrix'
import { offeringCoversPeriod } from '../utils/academicTerms'
import { useOwnStudentRecord } from '../hooks/useOwnStudentRecord'
import './StudentGradesPage.css'

// The student's grades, on their own page.
//
// Split out of the home page once that page had grown to roughly four
// screens. Home keeps what a student needs at a glance — the figures, the
// advice, the trends — and the detail they came looking for on purpose
// lives here, one click away rather than four scrolls down.
//
// LAYOUT (2026-11-13): the summary figures, then TABS — one per term,
// opening on the term the school is in, plus "Whole year". Each term is one
// list (components/MyTermGrades.jsx): a row per subject with its grade,
// status and movement, and the scores behind the grade folded inside the
// row. Before this the page printed every grade three times — a table per
// term, the class record per term, and the whole-year grid — which made it
// one very long scroll on a phone. The whole-year grid and the Movement
// chart answer a different question ("how is my year going?"), so they
// have their own tab rather than sitting under the term lists.

// One panel serves all four figures, so one id covers every card's
// aria-controls — they all point at the same region.
const GRADE_EXPLAINER_ID = 'grade-stat-explainer'

// One sentence about the movement above: the subject that moved most against
// the student if anything fell, otherwise the best news available.
//
// TIES ARE NAMED AS TIES. This took the first row and called it "the most",
// which is only true when nothing matches it — and on a small timetable
// matching is the ordinary case, not the exception. A learner whose five
// subjects every fell by exactly 12 was told "General Chemistry 1 fell the
// most, by 12 points", singling out a subject for a decline four others
// shared equally. The ranking was an artefact of the sort order.
function describeMovement(changes) {
  if (changes.length === 0) return null
  const worst = changes[0]
  const best = changes[changes.length - 1]

  // How many share the extreme — the whole question the old wording begged.
  const sharing = (value) => changes.filter((c) => c.value === value).length

  if (worst.value < 0) {
    const drop = Math.abs(worst.value)
    const tied = sharing(worst.value)
    const fell =
      tied === changes.length
        ? `All ${changes.length} subjects fell by ${drop} points.`
        : tied > 1
          ? `${tied} subjects fell by ${drop} points, the biggest drop.`
          : `${worst.label} fell the most, by ${drop} points.`
    if (best.value <= 0) return `${fell} Nothing rose this period.`
    const rose = sharing(best.value)
    return rose > 1
      ? `${fell} ${rose} subjects rose ${best.value}.`
      : `${fell} ${best.label} rose ${best.value}.`
  }

  if (best.value > 0) {
    const tied = sharing(best.value)
    return tied === changes.length
      ? `Everything improved, all by ${best.value} points.`
      : tied > 1
        ? `Everything held or improved — ${tied} subjects rose the most, by ${best.value} points.`
        : `Everything held or improved — ${best.label} rose the most, by ${best.value} points.`
  }
  return 'Every subject held exactly steady.'
}

// A subject's full history, opened from its row: every period's mark with the
// status attached, so an in-review mark is visibly not yet official, plus who
// to ask about it.
function SubjectDetail({ row, periods }) {
  const marks = periods.map((period) => ({ period, cell: row.cells[period.id] })).filter((m) => m.cell)

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
  // Which subject's history is open. One at a time, the same detail-on-demand
  // pattern Interventions and Academic Progress already use.
  const [expandedSubject, setExpandedSubject] = useState(null)
  // Which summary figure is currently explaining itself, or null.
  const [openStat, setOpenStat] = useState(null)
  // The learner's class record — every score behind every grade — fetched
  // once for all the term tabs. Null while loading.
  const [classRecord, setClassRecord] = useState(null)
  const [classRecordError, setClassRecordError] = useState(null)
  // One "how was this computed" dialog for every grade on the page.
  const [showBreakdown, breakdownDialog] = useGradeBreakdown()

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
    api
      .get(`/students/${student.id}/class-record`)
      .then(setClassRecord)
      .catch((err) => setClassRecordError(err.message))
  }, [student])

  // Class-record subjects by subject, so a term row can find the scores
  // behind its grade.
  const recordBySubject = useMemo(
    () => (classRecord ? new Map(classRecord.subjects.map((s) => [s.subjectId, s])) : null),
    [classRecord]
  )

  const passingGrade = subjects?.passingGrade ?? subjectGrades?.passingGrade ?? null

  // One row per subject, one cell per grading period — built by the same
  // utility the staff Grades tab uses (utils/gradeMatrix.js), so both views
  // of this learner group the same marks the same way. Rows start from the
  // class list so a subject with no mark yet still appears.
  const gradeMatrix = useMemo(() => buildGradeMatrix({ grades, subjects: subjects?.subjects }), [subjects, grades])

  // How each subject MOVED between its last two finalized marks — the one
  // thing the table above cannot show without the reader doing arithmetic
  // across every row. A chart of this period's marks would only redraw the
  // table's own column.
  //
  // Biggest drop first: the subject that moved most against the student is
  // the one worth reading first, the same "most urgent at the top" ordering
  // the rest of the student view uses.
  const subjectChanges = useMemo(() => {
    return gradeMatrix
      .map((row) => {
        const marked = gradingPeriods
          .filter((p) => row.cells[p.id]?.status === 'finalized')
          .map((p) => ({ name: p.name, value: row.cells[p.id].value }))
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

  // The term the school is actually in, tagged on its table. `periodName`
  // comes from the server's own current-period resolution (school timezone,
  // not the server's — see utils/schoolDate.js), so this does not re-derive
  // "what term is it" on the client. Null between terms.
  const currentPeriodId = useMemo(
    () => gradingPeriods.find((p) => p.name === subjectGrades?.periodName)?.id ?? null,
    [gradingPeriods, subjectGrades]
  )

  const periods = useMemo(() => [...gradingPeriods].sort((a, b) => a.sequence_number - b.sequence_number), [gradingPeriods])

  // Which tab opens: the term the school is in; between terms, the latest
  // term that has any mark; otherwise the first term.
  const defaultTab = useMemo(() => {
    if (currentPeriodId) return `term-${currentPeriodId}`
    const marked = [...periods].reverse().find((p) => gradeMatrix.some((r) => r.cells[p.id]))
    return marked ? `term-${marked.id}` : periods[0] ? `term-${periods[0].id}` : 'year'
  }, [currentPeriodId, periods, gradeMatrix])

  function toggleStat(key) {
    setOpenStat((current) => (current === key ? null : key))
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
    <div className="student-grades">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Grades' }]} />

      <div className="page-header">
        <h1>My Grades</h1>
      </div>

      {error && <Alert>{error}</Alert>}

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

      <div className="my-grades">
        <h2 className="sr-only">Your grades by term</h2>
        {periods.length === 0 || grades === null ? (
          // Until the terms and grades arrive, draw the shape that is coming.
          error ? null : <SkeletonTable rows={6} columns={4} />
        ) : (
          <Tabs
            // Remount when the opening tab is first known, so it opens there.
            key={defaultTab}
            defaultTab={defaultTab}
            tabs={[
              ...periods.map((period, index) => ({
                key: `term-${period.id}`,
                label: period.id === currentPeriodId ? `${period.name} · Now` : period.name,
                content: (
                  <MyTermGrades
                    period={period}
                    previousPeriod={periods[index - 1] || null}
                    // Only the subjects running in this term — a Grade 12
                    // subject changes every term, a specialized one runs
                    // all year (utils/academicTerms.js).
                    rows={gradeMatrix.filter((row) =>
                      offeringCoversPeriod({ term: row.term, subjectCategory: row.category, periodSequenceNumber: period.sequence_number })
                    )}
                    recordBySubject={recordBySubject}
                    recordError={classRecordError}
                    isCurrent={period.id === currentPeriodId}
                    passingGrade={passingGrade}
                    showBreakdown={showBreakdown}
                  />
                ),
              })),
              {
                key: 'year',
                label: 'Whole year',
                content: (
                  <div className="my-grades__year">
                    <p className="record-section__note">
                      Every subject against every term, the way a report card lays it out. Select a subject to see each
                      of its marks and who to ask about them.
                    </p>
                    <WholeYearGrid
                      gradeMatrix={gradeMatrix}
                      gradingPeriods={periods}
                      passingGrade={passingGrade}
                      error={error}
                      expandedSubject={expandedSubject}
                      setExpandedSubject={setExpandedSubject}
                    />
                    <ChartCard
                      title="Movement Since Last Term"
                      description="How each subject changed between its last two finalized marks — biggest drop first."
                      legend={[
                        { label: 'Improved', color: 'var(--band-performing-well)' },
                        { label: 'Dropped', color: 'var(--band-at-risk-high)' },
                      ]}
                      isEmpty={subjectChanges.length === 0}
                      emptyMessage="Two terms of finalized marks are needed before movement can be shown."
                      interpretation={describeMovement(subjectChanges)}
                    >
                      <ChangeBarChart rows={subjectChanges} />
                    </ChartCard>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
      {breakdownDialog}
    </div>
  )
}

// The whole-year grid: every subject down the side, every term across the
// top. This is the report-card shape the school already uses on paper, kept
// under the per-term tables because a parent reading a card wants the year
// in one grid — the per-term tables answer "what am I taking each term",
// which is a different question.
function WholeYearGrid({
  gradeMatrix,
  gradingPeriods,
  passingGrade,
  error,
  expandedSubject,
  setExpandedSubject,
}) {
  return (
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
                const cell = r.cells[period.id]
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
          rowKey={(r) => r.subjectId}
          error={error}
          onRowClick={(r) => setExpandedSubject((current) => (current === r.subjectId ? null : r.subjectId))}
          renderExpanded={(r) => (expandedSubject === r.subjectId ? <SubjectDetail row={r} periods={gradingPeriods} /> : null)}
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
  )
}
