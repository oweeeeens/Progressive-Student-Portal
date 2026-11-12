import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Upload, CheckCircle2, AlertTriangle, Check } from 'lucide-react'
import { api } from '../api/client'
import { defaultSelection } from '../utils/defaultSelection'
import { useConfirm } from '../hooks/useConfirm'
import { useToast } from '../context/ToastContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatusPill } from '../components/StatusPill'
import { SpotIllustration } from '../components/illustrations/SpotIllustration'
import { weightSplit } from '../utils/gradingPolicy'
import './GradesShared.css'
import './ClassRecord.css'

// Import the school's DepEd e-Class Record into the Class Record.
//
// The school already keeps each subject's scores in DepEd's official
// e-Class Record workbook (INPUT DATA + Term 1–3 sheets). Re-typing them
// would be the paper problem all over again, so the teacher uploads the
// workbook and the System reads it — every quiz, task and exam with its
// highest possible score, every learner's score — matches learners to the
// section by LRN, and shows the grade it computes beside the grade the
// workbook computed (the cross-check). Nothing is written until the teacher
// confirms, and importing never submits grades: the teacher still reviews
// the Class Record and submits it into the approval chain.

const STEPS = [
  { key: 'upload', label: 'Choose the class and file' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
]

export function ClassRecordImportPage() {
  const [searchParams] = useSearchParams()
  const [offerings, setOfferings] = useState([])
  const [offeringsError, setOfferingsError] = useState(null)
  const [classOfferingId, setClassOfferingId] = useState(searchParams.get('classOfferingId') || '')
  const [file, setFile] = useState(null)
  const [step, setStep] = useState('upload')
  const [parsed, setParsed] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirm, confirmDialog] = useConfirm()
  const { showToast } = useToast()

  useEffect(() => {
    api
      .get('/class-offerings/mine')
      .then((data) => {
        setOfferings(data.classOfferings)
        setClassOfferingId((current) => current || defaultSelection(data.classOfferings, true))
      })
      .catch((err) => setOfferingsError(`Couldn't load your classes: ${err.message}`))
  }, [])

  async function handleRead(e) {
    e.preventDefault()
    if (!file || !classOfferingId) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('classOfferingId', classOfferingId)
      const data = await api.upload('/class-record/import/parse', form)
      setParsed(data)
      setDecisions({})
      setStep('review')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const readyTerms = parsed ? parsed.plan.terms.filter((t) => t.status === 'ready') : []
  const undecided = readyTerms.filter((t) => t.needsDecision && !decisions[t.sequence])
  const termsToWrite = readyTerms.filter((t) => !(t.needsDecision && decisions[t.sequence] === 'skip'))

  async function handleCommit() {
    const replacing = termsToWrite.filter((t) => t.needsDecision).map((t) => t.periodName)
    const ok = await confirm({
      title: `Import ${termsToWrite.length} term${termsToWrite.length === 1 ? '' : 's'} into the class record?`,
      message: `${parsed.offering.subjectName} — Grade ${parsed.offering.gradeLevel} ${parsed.offering.sectionName}. Every item and score from the workbook is written to the Class Record. Grades are not submitted: you review them first.`,
      details: replacing.length > 0 ? <p>Replacing what is already recorded for: {replacing.join(', ')}.</p> : null,
      confirmLabel: 'Import',
      danger: replacing.length > 0,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const data = await api.post('/class-record/import/commit', {
        classOfferingId: Number(classOfferingId),
        terms: parsed.terms,
        decisions,
        fileName: parsed.fileName,
      })
      setResult(data)
      setStep('done')
      showToast(`Imported ${data.scoreCount} scores from ${parsed.fileName}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const currentIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Import Data', to: '/import' }, { label: 'e-Class Record' }]} />
      <div className="page-header">
        <h1>Import e-Class Record</h1>
      </div>

      <ol className="form-steps form-steps--static">
        {STEPS.map((s, index) => (
          <li className="form-steps__item" key={s.key}>
            {index > 0 && <span className={`form-steps__connector${index <= currentIndex ? ' is-done' : ''}`} />}
            <span
              className={`form-steps__step${index === currentIndex ? ' is-active' : ''}${index < currentIndex ? ' is-done' : ''}`}
              aria-current={index === currentIndex ? 'step' : undefined}
            >
              <span className="form-steps__index">{index < currentIndex ? <Check size={14} strokeWidth={2} /> : index + 1}</span>
              <span className="form-steps__label">{s.label}</span>
            </span>
          </li>
        ))}
      </ol>

      {offeringsError && <Alert>{offeringsError}</Alert>}
      {error && <Alert>{error}</Alert>}

      {step === 'upload' && (
        <form onSubmit={handleRead} className="panel class-record-import__upload">
          <SpotIllustration name="grades" />
          <p>
            Upload the subject&apos;s <strong>DepEd e-Class Record</strong> workbook (the one with the INPUT DATA and Term 1–3
            sheets). The System reads every written work, performance task and exam with its highest possible score, and
            every learner&apos;s score.
          </p>
          <div className="class-record__form">
            <label>
              Class (subject and section)
              <select value={classOfferingId} onChange={(e) => setClassOfferingId(e.target.value)} required>
                <option value="">-- select --</option>
                {offerings.map((o) => (
                  <option key={o.id} value={o.id}>
                    Grade {o.grade_level} - {o.section_name} · {o.subject_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              e-Class Record file (.xlsx)
              <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
            </label>
            <div className="button-row">
              <button type="submit" className="btn-primary" disabled={busy || !file || !classOfferingId}>
                <Upload size={16} strokeWidth={1.75} /> {busy ? 'Reading…' : 'Read workbook'}
              </button>
            </div>
          </div>
        </form>
      )}

      {step === 'review' && parsed && (
        <>
          <div className="class-record__policy">
            <span>
              <strong>{parsed.offering.subjectName}</strong> — Grade {parsed.offering.gradeLevel} {parsed.offering.sectionName} ·
              computed with {weightSplit(parsed.offering.weightGroup)}
            </span>
            <span className="text-muted">
              {parsed.fileName}
              {parsed.plan.workbook.subject ? ` · workbook says: ${parsed.plan.workbook.subject}${parsed.plan.workbook.section ? `, ${parsed.plan.workbook.section}` : ''}` : ''}
            </span>
          </div>

          {parsed.plan.terms.map((term) => (
            <section key={term.sequence} className="record-section">
              <h2>
                {term.periodName || term.sheetName}{' '}
                <span className="text-muted">· {term.itemCount} items in the workbook</span>
              </h2>
              {term.status !== 'ready' ? (
                <Alert variant="warning">{term.reason}</Alert>
              ) : (
                <>
                  <p className="help-text">
                    {term.learners.length} learner{term.learners.length === 1 ? '' : 's'} matched
                    {term.comparedCount > 0 &&
                      (term.mismatchCount === 0
                        ? ` · every compared grade matches the workbook (${term.comparedCount})`
                        : ` · ${term.mismatchCount} of ${term.comparedCount} grades differ from the workbook`)}
                  </p>
                  {term.mismatchCount > 0 && (
                    <Alert variant="warning">
                      Some grades the System computes differ from the workbook&apos;s own. This usually means the subject&apos;s
                      grading weights in the System (Subjects page) are not the ones the workbook used. The scores are still
                      imported exactly as written.
                    </Alert>
                  )}
                  {term.needsDecision && (
                    <label className="class-record-import__decision">
                      {term.periodName} already has {term.existingItemCount} item{term.existingItemCount === 1 ? '' : 's'} in the
                      Class Record.
                      <select value={decisions[term.sequence] || ''} onChange={(e) => setDecisions((d) => ({ ...d, [term.sequence]: e.target.value }))}>
                        <option value="">Choose…</option>
                        <option value="replace">Replace with this workbook</option>
                        <option value="skip">Keep what is recorded (skip this term)</option>
                      </select>
                    </label>
                  )}
                  <div className="table-card">
                    <table>
                      <thead>
                        <tr>
                          <th>Learner</th>
                          <th>Matched by</th>
                          <th className="is-right">Scores</th>
                          <th className="is-right">System grade</th>
                          <th className="is-right">Workbook grade</th>
                          <th>Check</th>
                        </tr>
                      </thead>
                      <tbody>
                        {term.learners.map((l) => (
                          <tr key={l.row}>
                            <td>{l.studentName}</td>
                            <td>{l.matchedBy}</td>
                            <td className="is-right">
                              {l.scoreCount} of {term.itemCount}
                            </td>
                            <td className="is-right">{l.computedTermGrade ?? '—'}</td>
                            <td className="is-right">{l.sheetTermGrade ?? '—'}</td>
                            <td>
                              {l.finalized ? (
                                <StatusPill label="Finalized — skipped" variant="neutral" />
                              ) : l.invalidItems.length > 0 ? (
                                <span className="class-record-import__bad">
                                  <AlertTriangle size={14} /> Score above the highest possible on {l.invalidItems.join(', ')} — skipped
                                </span>
                              ) : l.mismatch ? (
                                <span className="class-record-import__bad">
                                  <AlertTriangle size={14} /> Differs from workbook
                                </span>
                              ) : l.computedTermGrade === null ? (
                                <span className="text-muted">Scores incomplete</span>
                              ) : (
                                <span className="class-record-import__ok">
                                  <CheckCircle2 size={14} /> Matches
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {term.unmatched.length > 0 && (
                    <p className="help-text">
                      Not found in this section, so not imported: {term.unmatched.map((u) => `${u.name}${u.lrn ? ` (LRN ${u.lrn})` : ''}`).join('; ')}.
                    </p>
                  )}
                  {term.notInFile.length > 0 && (
                    <p className="help-text">In this section but not in the workbook: {term.notInFile.map((n) => n.name).join('; ')}.</p>
                  )}
                </>
              )}
            </section>
          ))}

          <div className="sticky-action-bar">
            <span className="sticky-action-bar__status" aria-live="polite">
              {readyTerms.length === 0
                ? 'Nothing in this workbook can be imported'
                : undecided.length > 0
                  ? `Choose replace or skip for ${undecided.map((t) => t.periodName).join(', ')}`
                  : `${termsToWrite.length} term${termsToWrite.length === 1 ? '' : 's'} ready to import`}
            </span>
            <button type="button" onClick={() => setStep('upload')} disabled={busy}>
              Back
            </button>
            <button type="button" className="btn-primary" onClick={handleCommit} disabled={busy || readyTerms.length === 0 || undecided.length > 0 || termsToWrite.length === 0}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <div className="empty-state">
          <SpotIllustration name="cleared" />
          <p>
            Imported {result.itemCount} items and {result.scoreCount} scores into {result.termsWritten.join(', ')}.
          </p>
          <p>Review the computed grades in the Class Record, then submit them for the principal&apos;s verification.</p>
          <div className="button-row mt-3">
            <Link to="/grades/entry" className="btn-primary">
              Open the Class Record
            </Link>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
