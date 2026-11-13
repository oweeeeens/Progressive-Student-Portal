import { useState } from 'react'
import { ArrowUp, ArrowDown, ChevronDown, Calculator } from 'lucide-react'
import { StatusPill } from './StatusPill'
import { Skeleton } from './Skeleton'
import { Alert } from './Alert'
import { GRADE_STATUS_LABELS, GRADE_STATUS_VARIANTS, finalizedAverageForPeriod } from '../utils/gradeMatrix'

// One term of the learner's own grades, as ONE list: each subject's grade,
// where it is in the approval chain and how it moved since the term before —
// and, on tap, the quiz, task and exam scores the grade was computed from.
//
// WHY ONE LIST. My Grades used to print every grade three times: a table per
// term, the class record's table per term ("Your Scores"), and the
// whole-year grid — seven tables before the one chart, on a page learners
// mostly read on a phone. The grade and the scores behind it answer one
// question ("why is my grade this?"), so they now live in one row, with the
// detail folded inside it until asked for.
//
// Props:
//   period          — this term ({ id, name, sequence_number })
//   previousPeriod  — the term before, for the "vs" movement, or null
//   rows            — this term's subjects, from utils/gradeMatrix.buildGradeMatrix,
//                     already filtered to the subjects running in it
//   recordBySubject — Map subjectId → the class-record subject
//                     (GET /students/:id/class-record), or null while loading
//   recordError     — why the class record could not load, if it did not
//   isCurrent       — this is the term the school is in today
//   passingGrade    — 75; marks under it are drawn in red, with a legend
//   showBreakdown   — opens the shared "how this was computed" dialog

const COMPONENT_ORDER = ['ww', 'pt', 'ex']
const COMPONENT_LABELS = { ww: 'Written / Oral Works', pt: 'Performance Tasks', ex: 'Examinations' }
const fmt2 = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))
const plain = (v) => (Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2))

// What the row shows as the grade: the official one when there is one,
// otherwise the class record's computed grade, labelled provisional — a grade
// nobody has submitted yet must never look official.
function describeGrade(cell, term) {
  if (cell) return { value: cell.value, kind: 'official', status: cell.status, computation: cell.computation || term?.computed || null }
  if (term?.provisional && term.computed?.termGrade != null) return { value: term.computed.termGrade, kind: 'provisional', computation: term.computed }
  if (term && term.items.length > 0) return { value: null, kind: 'incomplete' }
  return { value: null, kind: 'none' }
}

// Movement since the previous term — finalized marks on both sides only, the
// same rule as the staff term tables: a mark still in review is not yet real.
function Change({ now, before }) {
  if (now?.status !== 'finalized' || before?.status !== 'finalized') return null
  const delta = Math.round((now.value - before.value) * 10) / 10
  if (delta === 0) return <span className="mtg__change mtg__change--flat">No change</span>
  const Icon = delta > 0 ? ArrowUp : ArrowDown
  return (
    <span className={`mtg__change grade-change grade-change--${delta > 0 ? 'up' : 'down'}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {delta > 0 ? `+${delta}` : delta}
      <span className="sr-only"> since the term before</span>
    </span>
  )
}

// The scores behind one subject's grade in this term: a block per component
// with its weight, every score out of its highest possible score, and the
// percentage score — then the initial grade and the term grade it became.
function ScoreDetail({ subjectName, period, term, grade, recordError, showBreakdown }) {
  if (recordError) return <Alert>Couldn&apos;t load your scores: {recordError}</Alert>
  if (term === undefined) {
    return (
      <div className="mtg__loading" aria-label="Loading your scores">
        <Skeleton h="3.5rem" />
        <Skeleton h="3.5rem" />
        <Skeleton h="3.5rem" />
      </div>
    )
  }
  if (!term || term.items.length === 0) {
    return <p className="mtg__none">No scores recorded for {subjectName} in {period.name} yet.</p>
  }

  const computed = term.computed
  const components = COMPONENT_ORDER.map((key) => ({
    key,
    items: term.items.filter((i) => i.component === key),
    summary: computed?.components.find((c) => c.key === key) || null,
  })).filter((c) => c.items.length > 0 || c.summary)

  return (
    <>
      <div className="mtg__components">
        {components.map(({ key, items, summary }) => (
          <section key={key} className="mtg__component" aria-label={COMPONENT_LABELS[key]}>
            <h3>
              {COMPONENT_LABELS[key]}
              {summary && <span className="mtg__weight">{Math.round(summary.weight * 100)}%</span>}
            </h3>
            <ul className="mtg__chips">
              {items.map((item) => (
                <li key={item.id} className={`student-cr__chip${item.rawScore === null ? ' is-missing' : ''}`} title={item.title}>
                  <span className="sr-only">{item.title}: </span>
                  {item.rawScore === null ? '—' : plain(item.rawScore)}/{plain(item.highestPossibleScore)}
                </li>
              ))}
            </ul>
            <p className="mtg__ps">
              {summary?.percentageScore == null ? (
                <span className="text-muted">Incomplete — a blank is not a zero</span>
              ) : (
                <>
                  <strong>{fmt2(summary.percentageScore)}%</strong> percentage score
                </>
              )}
            </p>
          </section>
        ))}
      </div>
      <div className="mtg__result">
        <p>
          Initial grade <strong>{fmt2(computed?.initialGrade)}</strong>
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> becomes </span>
          term grade <strong>{grade.value ?? '—'}</strong>
        </p>
        {grade.computation && (
          <button
            type="button"
            className="btn-subtle"
            onClick={() => showBreakdown(`${subjectName} — ${period.name}`, grade.computation, grade.kind === 'official' ? grade.value : undefined)}
          >
            <Calculator size={16} strokeWidth={1.75} aria-hidden="true" />
            How this was computed
          </button>
        )}
      </div>
    </>
  )
}

export function MyTermGrades({ period, previousPeriod, rows, recordBySubject, recordError, isCurrent, passingGrade, showBreakdown }) {
  // One subject open at a time — the same detail-on-demand pattern the rest
  // of the System uses, and it keeps the list short on a phone.
  const [openSubject, setOpenSubject] = useState(null)
  const average = finalizedAverageForPeriod(rows, period.id)
  const graded = rows.filter((r) => r.cells[period.id]).length

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No subjects run for you in {period.name}.</p>
        <p>A class that runs for a single term appears in that term only.</p>
      </div>
    )
  }

  return (
    <div className="mtg">
      <p className="mtg__meta">
        {isCurrent && <span className="term-grades__tag">Current term</span>}
        {average != null && (
          <span>
            Average <strong className={passingGrade != null && average < passingGrade ? 'is-below' : undefined}>{average}</strong>
          </span>
        )}
        <span>
          {graded} of {rows.length} subject{rows.length === 1 ? '' : 's'} graded
        </span>
        <span className="mtg__hint">Tap a subject to see the scores behind its grade.</span>
      </p>

      <ul className="mtg__list">
        {rows.map((row) => {
          const cell = row.cells[period.id]
          const term = recordBySubject ? recordBySubject.get(row.subjectId)?.terms?.[period.id] || null : undefined
          const grade = describeGrade(cell, term || null)
          const open = openSubject === row.subjectId
          const panelId = `mtg-${period.id}-${row.subjectId}`
          const below = grade.value != null && passingGrade != null && grade.value < passingGrade
          return (
            <li key={row.subjectId} className={`mtg__item${open ? ' is-open' : ''}`}>
              <button
                type="button"
                className="mtg__row"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenSubject(open ? null : row.subjectId)}
              >
                <span className="mtg__subject">
                  <span className="mtg__name">{row.subjectName}</span>
                  <span className="mtg__teacher">{row.teacherName || 'No teacher assigned'}</span>
                </span>
                <span className={`mtg__grade${below ? ' is-below' : ''}${grade.kind === 'provisional' ? ' is-provisional' : ''}`}>
                  {grade.value ?? <span className="grade-cell__empty">—</span>}
                </span>
                <span className="mtg__status">
                  {grade.kind === 'official' && (
                    <StatusPill label={GRADE_STATUS_LABELS[grade.status] || grade.status} variant={GRADE_STATUS_VARIANTS[grade.status] || 'neutral'} />
                  )}
                  {grade.kind === 'provisional' && <StatusPill label="Provisional" variant="neutral" />}
                  {grade.kind === 'incomplete' && <span className="mtg__quiet">Scores incomplete</span>}
                  {grade.kind === 'none' && <span className="mtg__quiet">No grade yet</span>}
                </span>
                <span className="mtg__movement">
                  {previousPeriod && <Change now={cell} before={row.cells[previousPeriod.id]} />}
                </span>
                <ChevronDown className="mtg__chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
              {open && (
                <div id={panelId} className="mtg__detail">
                  {grade.kind === 'provisional' && (
                    <p className="mtg__note">
                      Computed from your recorded scores, but not yet submitted by your teacher — it is not official yet.
                    </p>
                  )}
                  <ScoreDetail
                    subjectName={row.subjectName}
                    period={period}
                    term={term}
                    grade={grade}
                    recordError={recordError}
                    showBreakdown={showBreakdown}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {passingGrade != null && (
        <p className="help-text">
          Grades below the passing grade of {passingGrade} are shown in red. Only a finalized grade is official and counts
          towards an average. Grades are computed from your scores as DepEd Order No. 015, s. 2026 prescribes.
        </p>
      )}
    </div>
  )
}
