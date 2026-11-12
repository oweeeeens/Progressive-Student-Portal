import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Calculator, FileUp } from 'lucide-react'
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

  const [confirm, confirmDialog] = useConfirm()
  const [showBreakdown, breakdownDialog] = useGradeBreakdown()
  const { showToast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    api
      .get('/class-offerings/mine')
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
      showToast(`Submitted ${result.submitted} computed grade${result.submitted === 1 ? '' : 's'} to the principal.`)
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

  const ready = Boolean(classOfferingId && gradingPeriodId)
  const learners = record?.learners || []
  const completeCount = learners.filter((l) => previews[l.studentId]?.complete).length

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
              <p className="live-summary-bar">
                <span>
                  {completeCount} of {learners.length} learners have a complete set of scores
                </span>
              </p>
              <div className="table-card class-record__scroll">
                <table className="class-record">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="class-record__name">Learner</th>
                      {groups.map((g) => (
                        <th key={g.key} colSpan={g.items.length + 2} className={`class-record__group class-record__group--${g.key}`}>
                          {g.label} <span className="text-muted">{pct(g.weight)}</span>
                        </th>
                      ))}
                      <th rowSpan={2} className="class-record__num">Initial grade</th>
                      <th rowSpan={2} className="class-record__num">Term grade</th>
                      <th rowSpan={2}>Status</th>
                    </tr>
                    <tr>
                      {groups.map((g) => [
                        ...g.items.map((item) => (
                          <th key={item.id} className="class-record__item" scope="col">
                            {canEdit ? (
                              <button type="button" className="link-button" onClick={() => openEditItem(item)} title="Edit this item">
                                {item.title} <Pencil size={11} strokeWidth={1.75} aria-hidden="true" />
                              </button>
                            ) : (
                              item.title
                            )}
                            <span className="class-record__hps">
                              {item.examPart ? `${PART_LABELS[item.examPart]} · ` : ''}of {item.highestPossibleScore}
                            </span>
                          </th>
                        )),
                        <th key={`${g.key}-ps`} className="class-record__num class-record__calc">PS</th>,
                        <th key={`${g.key}-ws`} className="class-record__num class-record__calc">WS</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {learners.map((learner) => {
                      const preview = previews[learner.studentId]
                      const locked = !canEdit || learner.grade?.status === 'finalized'
                      const name = `${learner.lastName}, ${learner.firstName}`
                      return (
                        <tr key={learner.studentId}>
                          <th scope="row" className="class-record__name">{name}</th>
                          {groups.map((g) => {
                            const comp = preview.components.find((c) => c.key === g.key)
                            return [
                              ...g.items.map((item) => {
                                const value = draft[learner.studentId]?.[item.id] ?? ''
                                const invalid = value !== '' && (Number(value) < 0 || Number(value) > item.highestPossibleScore)
                                return (
                                  <td key={item.id} className="class-record__score">
                                    <input
                                      type="number"
                                      min="0"
                                      max={item.highestPossibleScore}
                                      step="any"
                                      inputMode="decimal"
                                      value={value}
                                      disabled={locked}
                                      aria-invalid={invalid || undefined}
                                      aria-label={`${name}, ${item.title}, out of ${item.highestPossibleScore}`}
                                      onChange={(e) => setScore(learner.studentId, item.id, e.target.value)}
                                    />
                                  </td>
                                )
                              }),
                              <td key={`${g.key}-ps`} className="class-record__num class-record__calc">{fmt(comp?.percentageScore)}</td>,
                              <td key={`${g.key}-ws`} className="class-record__num class-record__calc">{fmt(comp?.weightedScore)}</td>,
                            ]
                          })}
                          <td className="class-record__num">{fmt(preview.initialGrade)}</td>
                          <td className="class-record__num class-record__grade">
                            {preview.termGrade === null ? (
                              <span className="text-muted" title="Every item needs a score before a grade is computed">—</span>
                            ) : isDirty ? (
                              <strong>{preview.termGrade}</strong>
                            ) : (
                              <button type="button" className="link-button" onClick={() => showBreakdown(`${name} — how the grade was computed`, learner.computed)}>
                                {preview.termGrade}
                              </button>
                            )}
                          </td>
                          <td>
                            {learner.grade && <StatusPill label={STATUS_LABELS[learner.grade.status]} variant={STATUS_VARIANTS[learner.grade.status]} />}
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
