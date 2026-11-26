import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Calculator, FileUp, Lock, Check, CheckCircle2, CircleDashed, TrendingDown, AlertTriangle, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { defaultSelection } from '../utils/defaultSelection'
import { useGradingPeriods } from '../hooks/useGradingPeriods'
import { useUnsavedChangesTracker } from '../hooks/useUnsavedChangesTracker'
import { useConfirm } from '../hooks/useConfirm'
import { useToast } from '../context/ToastContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { Modal } from '../components/Modal'
import { SkeletonTable } from '../components/Skeleton'
import { SpotIllustration } from '../components/illustrations/SpotIllustration'
import { useGradeBreakdown } from '../components/GradeBreakdown'
import { previewTermGrade } from '../utils/gradeCalculator'
import './GradesShared.css'
import './ClassRecord.css'
import { NoAssignmentNotice } from '../components/NoAssignmentNotice'

// The Class Record — where a term grade comes from.
//
// It replaces the old Enter Grades page, where a teacher typed a final grade.
// DepEd Order No. 015, s. 2026 (Annex D) makes a term grade the result of a
// computation over the learner's recorded scores, and the research adviser's
// point was that a typed grade cannot be checked. So a teacher now records
// the items a term is graded on — Written/Oral Works, Product/Performance
// Tasks, and the Examinations (Summative Tests 1 and 2 and the Term Exam) —
// with each item's highest possible score, and each learner's raw score.
// The System computes the rest: percentage, weighted score, initial grade,
// transmuted term grade. "Submit for review" sends the COMPUTED grades into
// the same approval chain as before (principal verifies, adviser finalizes).
//
// The term grade column previews while scores are typed (utils/
// gradeCalculator.js, fed DepEd's numbers by the server); the server
// recomputes everything on save and on submit, and only its result counts.

const STATUS_LABELS = { submitted: 'Submitted', principal_verified: 'Principal-verified', rejected: 'Rejected', finalized: 'Finalized' }
const STATUS_VARIANTS = { submitted: 'warning', principal_verified: 'info', rejected: 'negative', finalized: 'positive' }
const COMPONENT_LABELS = { ww: 'Written/Oral Works', pt: 'Performance Tasks', ex: 'Examinations' }
const PART_LABELS = { st1: 'Summative Test 1', st2: 'Summative Test 2', te: 'Term Exam' }
const pct = (fraction) => `${Math.round(fraction * 100)}%`
// The exam parts as DepEd's e-Class Record heads its columns.
const PART_SHORT = { st1: 'ST1', st2: 'ST2', te: 'TE' }
// A column's short heading, the way DepEd's e-Class Record numbers them:
// 1, 2, 3 … under Written Works and Performance Tasks; ST1, ST2, TE under
// Examinations. The full title stays on the button (tooltip and accessible
// name) and in the key under the grid — a long title used to set the whole
// column's width, which is what pushed the grid off the screen.
const shortLabel = (group, item, index) => (group.key === 'ex' ? PART_SHORT[item.examPart] || item.title : String(index + 1))
// Which components the grid shows: all, or one at a time for a long term.
const VIEW_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'ww', label: 'Written works' },
  { key: 'pt', label: 'Performance tasks' },
  { key: 'ex', label: 'Exams' },
]
// "Show computation" is remembered per browser — a personal preference, so
// localStorage, guarded: storage can be blocked.
const SHOW_CALC_KEY = 'studentPortal.classRecord.showComputation'
function readShowCalc() {
  try {
    return localStorage.getItem(SHOW_CALC_KEY) === 'true'
  } catch {
    return false
  }
}
const fmt = (value) => (value === null || value === undefined ? '—' : Number(value).toFixed(2))

// Scores as the inputs hold them: studentId -> { itemId: '17' }.
function scoresFromRecord(learners) {
  const draft = {}
  for (const learner of learners) {
    draft[learner.studentId] = Object.fromEntries(Object.entries(learner.scores).map(([itemId, raw]) => [itemId, String(raw)]))
  }
  return draft
}

const EMPTY_ITEM_FORM = { id: null, component: 'ww', examPart: 'st1', title: '', highestPossibleScore: '' }

export function ClassRecordPage() {
  const [offerings, setOfferings] = useState([])
  const [offeringsError, setOfferingsError] = useState(null)
  const [classOfferingId, setClassOfferingId] = useState('')
  const { periods, gradingPeriodId, setGradingPeriodId, error: periodsError } = useGradingPeriods()

  const [record, setRecord] = useState(null)
  const [draft, setDraft] = useState({})
  const [baselineVersion, setBaselineVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [itemForm, setItemForm] = useState(null)
  const [itemFormError, setItemFormError] = useState(null)
  // Compact entry (2026-11-26): the PS / WS columns are the System's
  // arithmetic, not inputs, so they are off until asked for; the Initial
  // and Term grade always show. And a long term can be entered one
  // component at a time.
  const [showCalc, setShowCalc] = useState(readShowCalc)
  const [view, setView] = useState('all')
  // The box being typed in, so its learner's row and its item's column can
  // be lit (a crosshair): the teacher always sees whose score, on what.
  const [focusCell, setFocusCell] = useState(null)

  const [confirm, confirmDialog] = useConfirm()
  const [showBreakdown, breakdownDialog] = useGradeBreakdown()
  const { showToast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    api
      .get('/class-offerings/recordable')
      .then((data) => {
        setOfferings(data.classOfferings)
        setClassOfferingId((current) => current || defaultSelection(data.classOfferings, true))
      })
      .catch((err) => setOfferingsError(`Couldn't load your classes: ${err.message}`))
  }, [])

  // Replaces the record on screen with a fresh one from the server and
  // makes it the new "saved" baseline.
  function applyRecord(data) {
    setRecord(data)
    setDraft(scoresFromRecord(data.learners))
    setBaselineVersion((v) => v + 1)
  }

  function load() {
    if (!classOfferingId || !gradingPeriodId) {
      setRecord(null)
      return
    }
    setLoading(true)
    setError(null)
    // A failed load clears the sheet rather than leaving the previous class's
    // scores editable under the newly chosen one.
    setRecord(null)
    api
      .get(`/class-record?classOfferingId=${classOfferingId}&gradingPeriodId=${gradingPeriodId}`)
      .then(applyRecord)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [classOfferingId, gradingPeriodId])

  const isDirty = useUnsavedChangesTracker(draft, baselineVersion, 'This class record has unsaved scores. Leave without saving?')

  const items = record?.items || []
  const policy = record?.policy
  const canEdit = Boolean(record?.canEdit)

  // Column groups in DepEd's order: WW, PT, then each exam part.
  const groups = useMemo(() => {
    if (!policy) return []
    const list = []
    if (policy.weights.ww !== null) list.push({ key: 'ww', label: COMPONENT_LABELS.ww, weight: policy.weights.ww, items: items.filter((i) => i.component === 'ww') })
    if (policy.weights.pt !== null) list.push({ key: 'pt', label: COMPONENT_LABELS.pt, weight: policy.weights.pt, items: items.filter((i) => i.component === 'pt') })
    if (policy.weights.ex !== null) {
      list.push({
        key: 'ex',
        label: COMPONENT_LABELS.ex,
        weight: policy.weights.ex,
        items: policy.examParts.flatMap((part) => items.filter((i) => i.component === 'ex' && i.examPart === part)),
      })
    }
    return list
  }, [items, policy])

  // Each learner's grade as the draft scores compute it right now.
  const previews = useMemo(() => {
    if (!record) return {}
    const out = {}
    for (const learner of record.learners) out[learner.studentId] = previewTermGrade(items, draft[learner.studentId] || {}, policy)
    return out
  }, [record, draft, items, policy])

  function setScore(studentId, itemId, value) {
    setDraft((current) => ({ ...current, [studentId]: { ...(current[studentId] || {}), [itemId]: value } }))
  }

  // Every input whose value differs from what the server last returned.
  function changedScores() {
    const changes = []
    for (const learner of record.learners) {
      for (const item of items) {
        const before = learner.scores[item.id]
        const now = draft[learner.studentId]?.[item.id]
        const nowValue = now === undefined || now === '' ? null : Number(now)
        const beforeValue = before === undefined ? null : Number(before)
        if (nowValue !== beforeValue) changes.push({ itemId: item.id, studentId: learner.studentId, rawScore: nowValue })
      }
    }
    return changes
  }

  async function handleSave() {
    const scores = changedScores()
    if (scores.length === 0) return
    setBusy('save')
    setError(null)
    try {
      const data = await api.put('/class-record/scores', { classOfferingId: Number(classOfferingId), gradingPeriodId: Number(gradingPeriodId), scores })
      applyRecord({ ...record, items: data.items, learners: data.learners })
      showToast(`Saved ${scores.length} score${scores.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function handleSubmit() {
    const learners = record.learners.filter((l) => l.grade?.status !== 'finalized')
    const complete = learners.filter((l) => l.computed.complete)
    const incomplete = learners.filter((l) => !l.computed.complete)
    const ok = await confirm({
      title: `Submit ${complete.length} computed grade${complete.length === 1 ? '' : 's'} for review?`,
      message: `${record.offering.subjectName} — Grade ${record.offering.gradeLevel} ${record.offering.sectionName}, ${record.period.name}. Each grade is computed from the scores on this record and sent to the principal for verification.`,
      details: incomplete.length > 0 ? (
        <>
          <p>Not submitted — scores still missing ({incomplete.length}):</p>
          <ul>
            {incomplete.slice(0, 5).map((l) => (
              <li key={l.studentId}>
                {l.lastName}, {l.firstName}: {l.computed.missing[0]}
                {l.computed.missing.length > 1 ? ` and ${l.computed.missing.length - 1} more` : ''}
              </li>
            ))}
            {incomplete.length > 5 && <li>and {incomplete.length - 5} more</li>}
          </ul>
        </>
      ) : null,
      confirmLabel: 'Submit for review',
    })
    if (!ok) return
    setBusy('submit')
    setError(null)
    try {
      const result = await api.post('/class-record/submit', { classOfferingId: Number(classOfferingId), gradingPeriodId: Number(gradingPeriodId) })
      // Grades already with the principal and unchanged keep their place in
      // review (a verified grade stays verified), so they are named apart.
      const unchanged = result.unchanged || 0
      const plural = (n) => (n === 1 ? '' : 's')
      showToast(
        result.submitted === 0
          ? `Nothing to resubmit: the ${unchanged} grade${plural(unchanged)} already in review ${unchanged === 1 ? 'is' : 'are'} unchanged.`
          : `Submitted ${result.submitted} computed grade${plural(result.submitted)} to the principal.` +
              (unchanged > 0 ? ` ${unchanged} unchanged grade${plural(unchanged)} already in review kept ${unchanged === 1 ? 'its' : 'their'} status.` : '')
      )
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  // --- items ------------------------------------------------------------------
  function openNewItem(component = 'ww', examPart = 'st1') {
    setItemFormError(null)
    setItemForm({ ...EMPTY_ITEM_FORM, component, examPart: policy?.examParts.includes(examPart) ? examPart : policy?.examParts[0] || 'st1' })
  }
  function openEditItem(item) {
    setItemFormError(null)
    setItemForm({ id: item.id, component: item.component, examPart: item.examPart || 'st1', title: item.title, highestPossibleScore: String(item.highestPossibleScore) })
  }

  async function saveItem(e) {
    e.preventDefault()
    setItemFormError(null)
    setBusy('item')
    try {
      const body = { title: itemForm.title, highestPossibleScore: Number(itemForm.highestPossibleScore) }
      if (itemForm.id) {
        await api.patch(`/class-record/items/${itemForm.id}`, body)
      } else {
        await api.post('/class-record/items', {
          ...body,
          classOfferingId: Number(classOfferingId),
          gradingPeriodId: Number(gradingPeriodId),
          component: itemForm.component,
          examPart: itemForm.component === 'ex' ? itemForm.examPart : null,
        })
      }
      showToast(itemForm.id ? `Updated “${itemForm.title}”.` : `Added “${itemForm.title}”.`)
      setItemForm(null)
      load()
    } catch (err) {
      setItemFormError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function deleteItem() {
    const ok = await confirm({
      title: `Delete “${itemForm.title}”?`,
      message: "The item and every learner's score on it are removed, and their grades are recomputed without it.",
      confirmLabel: 'Delete item',
      danger: true,
    })
    if (!ok) return
    setBusy('item')
    try {
      await api.delete(`/class-record/items/${itemForm.id}`)
      showToast(`Deleted “${itemForm.title}”.`)
      setItemForm(null)
      load()
    } catch (err) {
      setItemFormError(err.message)
    } finally {
      setBusy(null)
    }
  }

  function toggleShowCalc(on) {
    setShowCalc(on)
    try {
      localStorage.setItem(SHOW_CALC_KEY, String(on))
    } catch {
      // Blocked storage: the choice lasts for this visit only.
    }
  }

  // The groups the grid draws: the chosen component, or all of them. With
  // the computation hidden, a component with no items yet has no column at
  // all, so it is left out rather than drawn as an empty band.
  const visibleGroups = groups.filter((g) => (view === 'all' || g.key === view) && (showCalc || g.items.length > 0))

  // Spreadsheet keys: Enter moves down to the same item for the next
  // learner, Shift+Enter up — a quiz is entered down the class list, as on
  // paper and in Excel. Tab still moves across.
  // A finalized learner's boxes are locked (disabled), so the move skips
  // them and lands on the next learner whose score can still be typed.
  function moveVertically(event, rowIndex, colKey) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const step = event.shiftKey ? -1 : 1
    for (let row = rowIndex + step; row >= 0 && row < learners.length; row += step) {
      const target = document.querySelector(`.class-record input[data-row="${row}"][data-col="${colKey}"]`)
      if (target && !target.disabled) {
        target.focus()
        target.select()
        return
      }
    }
  }

  const ready = Boolean(classOfferingId && gradingPeriodId)
  const learners = record?.learners || []
  const completeCount = learners.filter((l) => previews[l.studentId]?.complete).length
  // The pass mark comes from the server's policy (gradingPolicy.PASSING_GRADE);
  // 75 is DepEd's, should an older server not send it.
  const passingGrade = policy?.passingGrade ?? 75

  // One cell's live state, from the draft against what the server last saved:
  // missing (no score typed), invalid (outside 0..HPS) and dirty (unsaved).
  function cellState(learner, item) {
    const value = draft[learner.studentId]?.[item.id] ?? ''
    const saved = learner.scores[item.id]
    const savedValue = saved === undefined || saved === null ? null : Number(saved)
    const nowValue = value === '' ? null : Number(value)
    return {
      value,
      missing: value === '',
      invalid: value !== '' && (Number.isNaN(nowValue) || nowValue < 0 || nowValue > item.highestPossibleScore),
      dirty: nowValue !== savedValue,
    }
  }

  // Per learner (over every item, not only the component on screen) and for
  // the summary strip. A finalized learner's scores are locked, so their
  // blanks are not work left to do and are not counted as missing.
  const { rowStates, summary } = useMemo(() => {
    const rows = {}
    const totals = { missing: 0, invalid: 0, unsaved: 0, below: 0 }
    for (const learner of learners) {
      const finalized = learner.grade?.status === 'finalized'
      let missing = 0
      for (const item of items) {
        const cell = cellState(learner, item)
        if (cell.missing && !finalized) missing += 1
        if (cell.invalid) totals.invalid += 1
        if (cell.dirty) totals.unsaved += 1
      }
      rows[learner.studentId] = { missing }
      totals.missing += missing
      const term = previews[learner.studentId]?.termGrade
      if (term !== null && term !== undefined && term < passingGrade) totals.below += 1
    }
    return { rowStates: rows, summary: totals }
    // cellState reads draft and learners, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learners, items, draft, previews, passingGrade])

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Grades' }, { label: 'Class Record' }]} />

      <div className="page-header">
        <h1>Class Record</h1>
        <div className="page-header__actions">
          <label>
            Class
            <select value={classOfferingId} onChange={(e) => setClassOfferingId(e.target.value)}>
              <option value="">-- select --</option>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  Grade {o.grade_level} - {o.section_name} · {o.subject_name}
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
      <NoAssignmentNotice kind="class" />

      {offeringsError && <Alert>{offeringsError}</Alert>}
      {periodsError && <Alert>{periodsError}</Alert>}
      {error && <Alert>{error}</Alert>}

      {!ready ? (
        <div className="empty-state">
          <SpotIllustration name="grades" />
          <p>Pick a class and a grading period.</p>
          <p>You will get its class record: the quizzes, tasks and exams the term is graded on, and every learner&apos;s score.</p>
        </div>
      ) : loading || !record ? (
        loading ? <SkeletonTable rows={6} columns={6} /> : null
      ) : (
        <>
          {/* How this subject is graded, said once, in DepEd's terms. */}
          <div className="class-record__policy">
            <Calculator size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong>{policy.weightGroupLabel}</strong> — Written/Oral Works {pct(policy.weights.ww)} · Performance Tasks {pct(policy.weights.pt)}
              {policy.weights.ex !== null ? ` · Examinations ${pct(policy.weights.ex)}` : ' · no examination'}
              {policy.examParts.length === 3 && ' (ST1 30%, ST2 30%, Term Exam 40%)'}
              {policy.mode === 'transmuted' ? ' · transmuted with the SY 2026–2027 table' : ' · zero-based'}
            </span>
            <span className="text-muted">{policy.source}</span>
          </div>

          {canEdit && (
            <div className="button-row mb-3">
              {/* The school's own DepEd e-Class Record workbook can be read in
                  instead of re-typing every score (ClassRecordImportPage). */}
              <button type="button" onClick={() => navigate(`/grades/entry/import?classOfferingId=${classOfferingId}`)}>
                <FileUp size={16} strokeWidth={1.75} /> Import e-Class Record
              </button>
              <button type="button" onClick={() => openNewItem('ww')}>
                <Plus size={16} strokeWidth={1.75} /> Written work
              </button>
              <button type="button" onClick={() => openNewItem('pt')}>
                <Plus size={16} strokeWidth={1.75} /> Performance task
              </button>
              {policy.examParts.length > 0 && (
                <button type="button" onClick={() => openNewItem('ex', policy.examParts.find((p) => !items.some((i) => i.examPart === p)) || 'te')}>
                  <Plus size={16} strokeWidth={1.75} /> Exam
                </button>
              )}
            </div>
          )}

          {learners.length === 0 ? (
            <div className="empty-state">
              <SpotIllustration name="roster" />
              <p>No learners in this class yet.</p>
              <p>The registrar assigns learners to a section before scores can be recorded.</p>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <SpotIllustration name="grades" />
              <p>No quizzes, tasks or exams recorded for {record.period.name} yet.</p>
              <p>{canEdit ? 'Add the first one above, with its highest possible score, then enter each learner’s score.' : 'The subject teacher has not recorded any yet.'}</p>
            </div>
          ) : (
            <>
              {/* What the grid says right now, as chips: each appears only when
                  it applies, and every count comes from the same draft the
                  boxes show, so the strip and the grid cannot disagree. */}
              <ul className="class-record__summary" aria-live="polite" aria-label="Class record summary">
                <li className={`cr-chip ${completeCount === learners.length ? 'cr-chip--good' : 'cr-chip--neutral'}`}>
                  {completeCount === learners.length ? <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" /> : <Users size={14} strokeWidth={2} aria-hidden="true" />}
                  <span>
                    Complete <strong>{completeCount}</strong> of {learners.length}
                  </span>
                </li>
                {summary.missing > 0 && (
                  <li className="cr-chip cr-chip--warn">
                    <CircleDashed size={14} strokeWidth={2} aria-hidden="true" />
                    <span>
                      <strong>{summary.missing}</strong> missing score{summary.missing === 1 ? '' : 's'}
                    </span>
                  </li>
                )}
                {summary.below > 0 && (
                  <li className="cr-chip cr-chip--danger">
                    <TrendingDown size={14} strokeWidth={2} aria-hidden="true" />
                    <span>
                      <strong>{summary.below}</strong> below {passingGrade}
                    </span>
                  </li>
                )}
                {summary.invalid > 0 && (
                  <li className="cr-chip cr-chip--danger">
                    <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
                    <span>
                      <strong>{summary.invalid}</strong> invalid score{summary.invalid === 1 ? '' : 's'}
                    </span>
                  </li>
                )}
                {summary.unsaved > 0 && (
                  <li className="cr-chip cr-chip--unsaved">
                    <span className="cr-dot" aria-hidden="true" />
                    <span>
                      <strong>{summary.unsaved}</strong> unsaved change{summary.unsaved === 1 ? '' : 's'}
                    </span>
                  </li>
                )}
              </ul>
              <div className="class-record__toolbar">
                <div className="class-record__view" role="group" aria-label="Components shown">
                  {VIEW_OPTIONS.filter((o) => o.key === 'all' || groups.some((g) => g.key === o.key)).map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      aria-pressed={view === o.key}
                      className={`class-record__view-option${view === o.key ? ' is-selected' : ''}`}
                      onClick={() => setView(o.key)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <label className="class-record__calc-toggle">
                  <input type="checkbox" checked={showCalc} onChange={(e) => toggleShowCalc(e.target.checked)} />
                  Show computation (PS / WS)
                </label>
                <span className="help-text class-record__keys-hint">Enter moves down a column · Tab moves across</span>
              </div>
              {visibleGroups.length === 0 ? (
                <p className="help-text">No items of this kind recorded for {record.period.name} yet.</p>
              ) : (
              <div className="table-card class-record__scroll">
                <table className={`class-record${focusCell ? ' has-focus' : ''}`}>
                  <thead>
                    <tr>
                      <th rowSpan={2} className="class-record__name">Learner</th>
                      {visibleGroups.map((g, gi) => (
                        <th
                          key={g.key}
                          colSpan={g.items.length + (showCalc ? 2 : 0)}
                          className={`class-record__group class-record__group--${g.key} is-band-start${gi % 2 === 1 ? ' is-band-alt' : ''}`}
                        >
                          <span className="class-record__group-label">{g.label}</span>
                          <span className="class-record__weight">{pct(g.weight)}</span>
                        </th>
                      ))}
                      <th colSpan={3} className="class-record__group class-record__group--result is-band-start is-result">
                        <span className="class-record__group-label">Result</span>
                      </th>
                    </tr>
                    <tr>
                      {visibleGroups.map((g, gi) => {
                        const band = gi % 2 === 1 ? ' is-band-alt' : ''
                        return [
                          ...g.items.map((item, index) => (
                            <th
                              key={item.id}
                              className={`class-record__item${band}${index === 0 ? ' is-band-start' : ''}${focusCell?.col === item.id ? ' is-focus-col' : ''}`}
                              scope="col"
                            >
                              {canEdit ? (
                                <button
                                  type="button"
                                  className="link-button"
                                  onClick={() => openEditItem(item)}
                                  title={`${item.title} — out of ${item.highestPossibleScore}. Click to edit.`}
                                  aria-label={`${item.title}, out of ${item.highestPossibleScore} — edit`}
                                >
                                  {shortLabel(g, item, index)} <Pencil size={10} strokeWidth={1.75} aria-hidden="true" />
                                </button>
                              ) : (
                                <span className="class-record__item-label" title={item.title}>{shortLabel(g, item, index)}</span>
                              )}
                              <span className="class-record__hps">/{item.highestPossibleScore}</span>
                            </th>
                          )),
                          ...(showCalc
                            ? [
                                <th key={`${g.key}-ps`} className={`class-record__num class-record__calc${band}${g.items.length === 0 ? ' is-band-start' : ''}`}>PS</th>,
                                <th key={`${g.key}-ws`} className={`class-record__num class-record__calc${band}`}>WS</th>,
                              ]
                            : []),
                        ]
                      })}
                      <th className="class-record__num is-result is-band-start">Initial</th>
                      <th className="class-record__num is-result class-record__term-col">Term grade</th>
                      <th className="is-result">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {learners.map((learner, rowIndex) => {
                      const preview = previews[learner.studentId]
                      const finalized = learner.grade?.status === 'finalized'
                      const locked = !canEdit || finalized
                      const name = `${learner.lastName}, ${learner.firstName}`
                      const rowState = rowStates[learner.studentId]
                      const below = preview.termGrade !== null && preview.termGrade < passingGrade
                      return (
                        <tr
                          key={learner.studentId}
                          className={`${focusCell?.row === rowIndex ? 'is-focus-row' : ''}${finalized ? ' is-locked' : ''}`.trim() || undefined}
                        >
                          <th scope="row" className="class-record__name">
                            <div className="class-record__name-inner">
                            <span className="class-record__name-text">{name}</span>
                            {finalized ? (
                              <span className="cr-row-badge cr-row-badge--locked" title="Finalized — the scores behind this grade are locked">
                                <Lock size={12} strokeWidth={2} aria-hidden="true" />
                                <span className="sr-only">Finalized, scores locked</span>
                              </span>
                            ) : rowState.missing > 0 ? (
                              <span className="cr-row-badge cr-row-badge--missing" title={`${rowState.missing} score${rowState.missing === 1 ? '' : 's'} still missing`}>
                                {rowState.missing} missing
                              </span>
                            ) : (
                              <span className="cr-row-badge cr-row-badge--complete" title="Every item has a score">
                                <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                                <span className="sr-only">All scores in</span>
                              </span>
                            )}
                            </div>
                          </th>
                          {visibleGroups.map((g, gi) => {
                            const band = gi % 2 === 1 ? ' is-band-alt' : ''
                            const comp = preview.components.find((c) => c.key === g.key)
                            return [
                              ...g.items.map((item, index) => {
                                const cell = cellState(learner, item)
                                const classes = [
                                  'class-record__score',
                                  band,
                                  index === 0 ? 'is-band-start' : '',
                                  focusCell?.col === item.id ? 'is-focus-col' : '',
                                  !locked && cell.missing ? 'is-missing' : '',
                                  cell.invalid ? 'is-invalid' : '',
                                  cell.dirty ? 'is-dirty' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')
                                  .replace(/\s+/g, ' ')
                                  .trim()
                                if (locked) {
                                  // A finalized (or read-only) score is a figure,
                                  // not a box: nothing here can be typed into.
                                  return (
                                    <td key={item.id} className={`${classes} is-readonly`}>
                                      {cell.value === '' ? (<><span className="text-muted" aria-hidden="true">—</span><span className="sr-only">no score</span></>) : cell.value}
                                    </td>
                                  )
                                }
                                const hints = [cell.missing ? 'no score yet' : '', cell.invalid ? `must be 0 to ${item.highestPossibleScore}` : '', cell.dirty ? 'not saved yet' : ''].filter(Boolean)
                                return (
                                  <td key={item.id} className={classes}>
                                    <input
                                      type="number"
                                      min="0"
                                      max={item.highestPossibleScore}
                                      step="any"
                                      inputMode="decimal"
                                      value={cell.value}
                                      aria-invalid={cell.invalid || undefined}
                                      aria-label={`${name}, ${item.title}, out of ${item.highestPossibleScore}${hints.length ? ` (${hints.join(', ')})` : ''}`}
                                      title={cell.invalid ? `Highest possible is ${item.highestPossibleScore}` : undefined}
                                      data-row={rowIndex}
                                      data-col={item.id}
                                      onFocus={() => setFocusCell({ row: rowIndex, col: item.id })}
                                      onBlur={() => setFocusCell((current) => (current?.row === rowIndex && current?.col === item.id ? null : current))}
                                      onKeyDown={(e) => moveVertically(e, rowIndex, item.id)}
                                      // A scroll over a focused number box must not change the
                                      // score: blur it, so the wheel scrolls the page instead.
                                      onWheel={(e) => e.currentTarget.blur()}
                                      onChange={(e) => setScore(learner.studentId, item.id, e.target.value)}
                                    />
                                  </td>
                                )
                              }),
                              ...(showCalc
                                ? [
                                    <td key={`${g.key}-ps`} className={`class-record__num class-record__calc${band}${g.items.length === 0 ? ' is-band-start' : ''}`}>{fmt(comp?.percentageScore)}</td>,
                                    <td key={`${g.key}-ws`} className={`class-record__num class-record__calc${band}`}>{fmt(comp?.weightedScore)}</td>,
                                  ]
                                : []),
                            ]
                          })}
                          <td className="class-record__num is-result is-band-start class-record__initial">{fmt(preview.initialGrade)}</td>
                          <td className="class-record__num is-result class-record__term-col">
                            {preview.termGrade === null ? (
                              <span className="cr-grade cr-grade--none" title="Every item needs a score before a grade is computed">
                                —<span className="sr-only">no grade yet</span>
                              </span>
                            ) : isDirty ? (
                              <span
                                className={`cr-grade ${below ? 'cr-grade--below' : 'cr-grade--pass'}`}
                                title={below ? `Below ${passingGrade} — preview of unsaved scores` : 'Preview of unsaved scores'}
                              >
                                {preview.termGrade}
                                {below && <span className="sr-only"> (below {passingGrade})</span>}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={`cr-grade cr-grade--button ${below ? 'cr-grade--below' : 'cr-grade--pass'}`}
                                title={below ? `Below ${passingGrade} — see how it was computed` : 'See how it was computed'}
                                aria-label={`${preview.termGrade}${below ? `, below ${passingGrade}` : ''} — how ${name}'s grade was computed`}
                                onClick={() => showBreakdown(`${name} — how the grade was computed`, learner.computed)}
                              >
                                {preview.termGrade}
                              </button>
                            )}
                          </td>
                          <td className="is-result class-record__status">
                            {learner.grade ? (
                              <StatusPill label={STATUS_LABELS[learner.grade.status]} variant={STATUS_VARIANTS[learner.grade.status]} />
                            ) : (
                              <span className="text-muted class-record__not-submitted">Not submitted</span>
                            )}
                            {learner.changedSinceSubmission && !isDirty && (
                              <p className="grade-rejection-note">Scores changed since submitting ({learner.grade.value} on record) — submit again.</p>
                            )}
                            {learner.grade?.status === 'rejected' && learner.grade.rejectionNote && (
                              <p className="grade-rejection-note">{learner.grade.rejectionNote}</p>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              )}
              {/* The key to the numbered columns: which item each number is,
                  one row of chips per component. */}
              {visibleGroups.some((g) => g.items.length > 0) && (
                <div className="class-record__key" aria-label="Column key">
                  {visibleGroups
                    .filter((g) => g.items.length > 0)
                    .map((g) => (
                      <p key={g.key} className="class-record__key-row">
                        <span className="class-record__key-label">{COMPONENT_LABELS[g.key]}:</span>{' '}
                        {g.items.map((item, i) => (
                          <span key={item.id} className="class-record__key-item">
                            <b>{shortLabel(g, item, i)}</b> {item.title}
                            {i < g.items.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </p>
                    ))}
                </div>
              )}

              {canEdit && (
                <div className="sticky-action-bar">
                  <span className={`sticky-action-bar__status${isDirty ? ' is-dirty' : ''}`} aria-live="polite">
                    {isDirty ? 'Unsaved scores — save before submitting' : 'All scores saved'}
                  </span>
                  <button type="button" onClick={handleSave} disabled={!isDirty || busy !== null}>
                    {busy === 'save' ? 'Saving…' : 'Save scores'}
                  </button>
                  <button type="button" className="btn-primary" onClick={handleSubmit} disabled={isDirty || busy !== null || completeCount === 0}>
                    {busy === 'submit' ? 'Submitting…' : 'Submit for review'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      <Modal open={Boolean(itemForm)} onClose={() => setItemForm(null)} title={itemForm?.id ? 'Edit item' : 'Add an item'} size="narrow">
        {itemForm && (
          <form onSubmit={saveItem} className="class-record__form">
            {itemFormError && <Alert>{itemFormError}</Alert>}
            {!itemForm.id && (
              <label>
                Component
                <select value={itemForm.component} onChange={(e) => setItemForm((f) => ({ ...f, component: e.target.value }))}>
                  <option value="ww">Written/Oral Work (quiz, seatwork, recitation)</option>
                  <option value="pt">Product/Performance Task (project, output, participation)</option>
                  {policy?.examParts.length > 0 && <option value="ex">Examination</option>}
                </select>
              </label>
            )}
            {!itemForm.id && itemForm.component === 'ex' && (
              <label>
                Which exam
                <select value={itemForm.examPart} onChange={(e) => setItemForm((f) => ({ ...f, examPart: e.target.value }))}>
                  {policy.examParts.map((part) => (
                    <option key={part} value={part}>
                      {PART_LABELS[part]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Title
              <input required maxLength={120} value={itemForm.title} onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Quiz 1" />
            </label>
            <label>
              Highest possible score
              <input required type="number" min="0.01" step="any" value={itemForm.highestPossibleScore} onChange={(e) => setItemForm((f) => ({ ...f, highestPossibleScore: e.target.value }))} />
            </label>
            <div className="button-row">
              {itemForm.id && (
                <button type="button" className="btn-danger" onClick={deleteItem} disabled={busy !== null}>
                  Delete
                </button>
              )}
              <button type="button" onClick={() => setItemForm(null)} disabled={busy !== null}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy !== null}>
                {busy === 'item' ? 'Saving…' : itemForm.id ? 'Save item' : 'Add item'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      {confirmDialog}
      {breakdownDialog}
    </div>
  )
}
