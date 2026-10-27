import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  Upload,
  ArrowLeft,
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  Layers,
  CheckCircle2,
  AlertTriangle,
  CircleSlash,
  Users,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { Alert } from '../components/Alert'
import { StatusPill } from '../components/StatusPill'
import { SpotIllustration } from '../components/illustrations/SpotIllustration'

// Bulk import of the school's existing SF2 spreadsheets — students down the
// side, school days across the top, a mark in each cell. Marking attendance
// by hand (Daily Attendance / Subject Attendance) is unchanged and remains
// the normal path; this page exists for the backlog of Excel files the
// school already keeps.
//
// Five steps, held in component state rather than the URL for the same
// reason the student importer's four are: a half-finished import is not
// something to resume from a link, and refreshing is meant to start over.
// Nothing is stored server-side until the last step (see
// backend/controllers/attendanceImportController.js).
const IMPORT_STEPS = [
  { key: 'target', label: 'What and where' },
  { key: 'anchors', label: 'Point at the grid' },
  { key: 'symbols', label: 'Map the marks' },
  { key: 'review', label: 'Review' },
  { key: 'result', label: 'Done' },
]

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// The four statuses the register accepts, plus "don't import this mark at
// all" for a weekend column, a subtotal or a stray note. Mirrors
// backend/config/attendanceImport.js.
const STATUS_CHOICES = [
  { value: 'present', label: 'Present', variant: 'positive' },
  { value: 'absent', label: 'Absent', variant: 'negative' },
  { value: 'late', label: 'Late', variant: 'warning' },
  { value: 'excused', label: 'Excused', variant: 'info' },
  { value: 'ignore', label: "Don't import", variant: 'neutral' },
]

// A blank cell is shown as a named thing, not as nothing: it is the single
// assumption that decides the most cells in a real SF2, where only
// exceptions get marked.
function symbolLabel(symbol) {
  return symbol === '' ? 'Blank cell' : symbol
}

export function BulkImportAttendancePage() {
  const { user } = useAuth()
  const [step, setStep] = useState('target')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Step 1 — which register, and which section or class.
  const [mode, setMode] = useState('daily')
  const [sections, setSections] = useState([])
  const [offerings, setOfferings] = useState([])
  const [sectionId, setSectionId] = useState('')
  const [classOfferingId, setClassOfferingId] = useState('')

  // The chosen file is kept, not just its parsed contents: step 2 sends it
  // up again once the user has confirmed where the grid is, because the raw
  // cell matrix is far larger than the anchors needed to read it.
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState([])
  const [columnCount, setColumnCount] = useState(0)

  // Step 2 — where the grid is. Pre-filled from the server's guesses, which
  // the user confirms or corrects; nothing is interpreted until they do.
  const [lrnColumn, setLrnColumn] = useState(null)
  const [dayRow, setDayRow] = useState(null)
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')

  // Step 3 — what each mark in the file means.
  const [students, setStudents] = useState([])
  const [symbols, setSymbols] = useState([])
  const [symbolMap, setSymbolMap] = useState({})

  // Step 4 — the plan, and a decision per already-recorded date.
  const [plan, setPlan] = useState(null)
  const [conflictDecisions, setConflictDecisions] = useState({})

  const [result, setResult] = useState(null)

  const target = mode === 'subject' ? { mode, classOfferingId: Number(classOfferingId) } : { mode, sectionId: Number(sectionId) }
  const targetChosen = mode === 'subject' ? Boolean(classOfferingId) : Boolean(sectionId)
  const unmappedSymbols = symbols.filter((s) => !symbolMap[s.symbol])
  const undecidedConflicts = (plan?.conflicts || []).filter((c) => !conflictDecisions[c.date])
  const skippedCount = (plan?.conflicts || []).filter((c) => conflictDecisions[c.date] === 'skip').length
  const datesToWrite = (plan?.summary.dateCount || 0) - skippedCount

  function resetAll() {
    setStep('target')
    setFile(null)
    setFileName('')
    setPreview([])
    setColumnCount(0)
    setLrnColumn(null)
    setDayRow(null)
    setMonth('')
    setYear('')
    setStudents([])
    setSymbols([])
    setSymbolMap({})
    setPlan(null)
    setConflictDecisions({})
    setResult(null)
    setError(null)
  }

  // Whichever list the chosen register needs, fetched when that register is
  // chosen (and once on mount for the default). admin/registrar see every
  // section; everyone else only sees sections they actually advise — the same
  // scoping the two marking pages use, and the server enforces it either way.
  useEffect(() => {
    let cancelled = false
    const path =
      mode === 'subject'
        ? '/class-offerings/mine'
        : ['admin', 'registrar'].includes(user.role)
          ? '/sections'
          : '/sections/mine'

    api
      .get(path)
      .then((data) => {
        if (cancelled) return
        if (mode === 'subject') setOfferings(data.classOfferings)
        else setSections(data.sections)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })

    // Switching register mid-fetch would otherwise let the slower response
    // land in the wrong list.
    return () => {
      cancelled = true
    }
  }, [mode, user.role])

  async function handleFileSelected(e) {
    const chosen = e.target.files[0]
    e.target.value = '' // lets choosing the same file again still fire onChange
    if (!chosen) return

    setLoading(true)
    setError(null)
    // The target goes up with the file: the server checks ownership on this
    // step too, so it has to know which register and which section/class the
    // sheet is being pointed at before it reads a single cell.
    const formData = new FormData()
    formData.append('file', chosen)
    formData.append('mode', mode)
    if (mode === 'subject') formData.append('classOfferingId', classOfferingId)
    else formData.append('sectionId', sectionId)
    try {
      const data = await api.upload('/attendance/bulk-import/parse', formData)
      setFile(chosen)
      setFileName(data.fileName)
      setPreview(data.preview)
      setColumnCount(data.columnCount)
      setLrnColumn(data.suggestion.lrnColumn)
      setDayRow(data.suggestion.dayRow)
      setMonth(data.suggestion.month ? String(data.suggestion.month) : '')
      setYear(data.suggestion.year ? String(data.suggestion.year) : '')
      setStep('anchors')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Sends the confirmed anchors back with the file, and gets the grid the
  // import would read: which learners, which dates, and every distinct mark
  // with how often it appears.
  async function handleInspect() {
    setLoading(true)
    setError(null)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)
    if (mode === 'subject') formData.append('classOfferingId', classOfferingId)
    else formData.append('sectionId', sectionId)
    formData.append('lrnColumn', lrnColumn)
    formData.append('dayRow', dayRow)
    formData.append('month', month)
    formData.append('year', year)
    try {
      const data = await api.upload('/attendance/bulk-import/inspect', formData)
      setStudents(data.students)
      setSymbols(data.symbols)
      setSymbolMap(data.suggestedSymbolMap)
      setStep('symbols')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleValidate() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.post('/attendance/bulk-import/validate', {
        ...target,
        students,
        symbols,
        symbolMap,
      })
      setPlan(data)
      setConflictDecisions({})
      setStep('review')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.post('/attendance/bulk-import/commit', {
        ...target,
        students,
        symbolMap,
        conflictDecisions,
        fileName,
      })
      setResult(data)
      setStep('result')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const currentStepIndex = IMPORT_STEPS.findIndex((s) => s.key === step)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Attendance' }, { label: 'Bulk Import' }]} />

      <div className="page-header">
        <h1>Bulk Import Attendance</h1>
      </div>

      {/* Read-only, like the student importer's: you cannot jump to Review
          before a file has been read and its grid located. */}
      <ol className="form-steps form-steps--static">
        {IMPORT_STEPS.map((s, index) => (
          <li className="form-steps__item" key={s.key}>
            {index > 0 && <span className={`form-steps__connector${index <= currentStepIndex ? ' is-done' : ''}`} />}
            <span
              className={`form-steps__step${index === currentStepIndex ? ' is-active' : ''}${
                index < currentStepIndex ? ' is-done' : ''
              }`}
              aria-current={index === currentStepIndex ? 'step' : undefined}
            >
              <span className="form-steps__index">
                {index < currentStepIndex ? <Check size={14} strokeWidth={2} /> : index + 1}
              </span>
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {error && <Alert>{error}</Alert>}

      {step === 'target' && (
        <div className="panel import-upload">
          <SpotIllustration name="calendar" />
          <h2>Import an attendance sheet</h2>
          <p className="form-note">
            An .xlsx file shaped like an SF2 — learners down the side, school days across the top, a mark in
            each cell. Choose which register it belongs to, then pick the file.
          </p>

          <div className="import-target">
            <fieldset className="import-target__modes">
              <legend className="form-field__label">Which register</legend>
              <label className={`import-target__mode${mode === 'daily' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="register"
                  value="daily"
                  checked={mode === 'daily'}
                  onChange={() => setMode('daily')}
                />
                <CalendarCheck size={18} strokeWidth={1.75} />
                <span>
                  <strong>Daily (SF2)</strong>
                  <small>The adviser's official record. Feeds the risk calculation.</small>
                </span>
              </label>
              <label className={`import-target__mode${mode === 'subject' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="register"
                  value="subject"
                  checked={mode === 'subject'}
                  onChange={() => setMode('subject')}
                />
                <ClipboardList size={18} strokeWidth={1.75} />
                <span>
                  <strong>Subject</strong>
                  <small>Per-class, logged by the teacher. Not used in risk scoring.</small>
                </span>
              </label>
            </fieldset>

            <div className="form-field form-field--medium">
              <label htmlFor="import-target-picker" className="form-field__label">
                <Layers size={16} strokeWidth={1.75} />
                {mode === 'subject' ? 'Class' : 'Section'}
                <span className="required-mark"> *</span>
              </label>
              {mode === 'subject' ? (
                <select
                  id="import-target-picker"
                  value={classOfferingId}
                  onChange={(e) => setClassOfferingId(e.target.value)}
                >
                  <option value="">-- Select a class --</option>
                  {offerings.map((o) => (
                    <option key={o.id} value={o.id}>
                      Grade {o.grade_level} - {o.section_name} · {o.subject_name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  id="import-target-picker"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                >
                  <option value="">-- Select a section --</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      Grade {s.grade_level} - {s.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="form-note">
                Learners are matched by LRN, and only against this {mode === 'subject' ? 'class' : 'section'} —
                an LRN from elsewhere in the school is reported, never written in here.
              </p>
            </div>
          </div>

          <div className="import-upload__actions">
            <label className={`btn-primary import-upload__file${targetChosen ? '' : ' is-disabled'}`}>
              <Upload size={16} strokeWidth={1.75} />
              {loading ? 'Reading…' : 'Choose File'}
              <input
                type="file"
                accept=".xlsx"
                onChange={handleFileSelected}
                disabled={loading || !targetChosen}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>
      )}

      {step === 'anchors' && (
        <div className="record-section">
          <h2>2. Point at the grid</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>
            {fileName} — the first {Math.max(preview.length - 1, 0)} rows are shown. SF2 forms put a header
            block above the grid, so the import has to be told exactly where the learners and the days are.
            Click a column heading to mark the LRN column, and a row number to mark the day row.
          </p>

          <div className="grid-pick">
            <table>
              <thead>
                <tr>
                  <th className="grid-pick__corner" scope="col">
                    Row
                  </th>
                  {Array.from({ length: columnCount }, (_, i) => i + 1).map((col) => (
                    <th key={col} scope="col" className={col === lrnColumn ? 'is-picked' : undefined}>
                      <button type="button" onClick={() => setLrnColumn(col)}>
                        {col === lrnColumn ? 'LRN' : col}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* preview is 1-indexed to match what a person sees in Excel,
                    so index 0 is an unused hole — skipped rather than
                    rendered as a blank first row. */}
                {preview.map((row, rowNumber) =>
                  rowNumber === 0 ? null : (
                    <tr key={rowNumber} className={rowNumber === dayRow ? 'is-picked' : undefined}>
                      <th scope="row" className={rowNumber === dayRow ? 'is-picked' : undefined}>
                        <button type="button" onClick={() => setDayRow(rowNumber)}>
                          {rowNumber === dayRow ? 'Days' : rowNumber}
                        </button>
                      </th>
                      {Array.from({ length: columnCount }, (_, i) => i + 1).map((col) => (
                        <td key={col} className={col === lrnColumn ? 'is-picked' : undefined}>
                          {(row || [])[col] ?? ''}
                        </td>
                      ))}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>

          <div className="import-anchors">
            <div className="form-field form-field--short">
              <label htmlFor="import-month" className="form-field__label">
                <CalendarRange size={16} strokeWidth={1.75} />
                Month
                <span className="required-mark"> *</span>
              </label>
              <select id="import-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">-- Select --</option>
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field form-field--short">
              <label htmlFor="import-year" className="form-field__label">
                <CalendarRange size={16} strokeWidth={1.75} />
                Year
                <span className="required-mark"> *</span>
              </label>
              <input
                id="import-year"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
          </div>
          <p className="form-note">
            The day numbers only say "1", "2", "3" — the month and year are what turn them into real dates, so
            check them against the sheet's own header before continuing.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={resetAll}>
              <ArrowLeft size={16} strokeWidth={1.75} />
              Start Over
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={loading || !lrnColumn || !dayRow || !month || !year}
              onClick={handleInspect}
            >
              {loading ? 'Reading the grid…' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {step === 'symbols' && (
        <div className="record-section">
          <h2>3. Map the marks</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>
            Every distinct mark found in the grid, most common first. One school's "X" is an absence and
            another's is a tick, so nothing is assumed — say what each one means before anything is written.
          </p>

          <div className="table-card" style={{ marginTop: 'var(--space-3)' }}>
            <table>
              <thead>
                <tr>
                  <th>Mark in your file</th>
                  <th>Cells</th>
                  <th>Means</th>
                </tr>
              </thead>
              <tbody>
                {symbols.map((s) => (
                  <tr key={s.symbol || '(blank)'}>
                    <td>
                      {s.symbol === '' ? (
                        <StatusPill label="Blank cell" variant="neutral" />
                      ) : (
                        <code className="alert__code">{s.symbol}</code>
                      )}
                    </td>
                    <td>{s.count.toLocaleString()}</td>
                    <td>
                      <div className="symbol-map__choice">
                        <select
                          value={symbolMap[s.symbol] || ''}
                          aria-label={`What ${symbolLabel(s.symbol)} means`}
                          onChange={(e) =>
                            setSymbolMap((prev) => ({ ...prev, [s.symbol]: e.target.value || null }))
                          }
                        >
                          <option value="">-- Choose --</option>
                          {STATUS_CHOICES.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                        {/* The status's own colour beside the dropdown, so a
                            whole sheet's mapping can be checked at a glance
                            instead of read one row at a time. */}
                        {symbolMap[s.symbol] && (
                          <StatusPill
                            label={STATUS_CHOICES.find((c) => c.value === symbolMap[s.symbol])?.label || ''}
                            variant={STATUS_CHOICES.find((c) => c.value === symbolMap[s.symbol])?.variant}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {symbolMap[''] === 'present' && (
            <Alert variant="info" title="Blank cells will be imported as Present">
              That is the DepEd convention — a real SF2 is marked only where something happened — and it is the
              assumption that decides the most cells here ({symbols.find((s) => s.symbol === '')?.count.toLocaleString() || 0}{' '}
              of them). Change it above if this sheet works differently.
            </Alert>
          )}

          {unmappedSymbols.length > 0 && (
            <Alert variant="warning">
              Still need a meaning: {unmappedSymbols.map((s) => symbolLabel(s.symbol)).join(', ')}
            </Alert>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={() => setStep('anchors')}>
              <ArrowLeft size={16} strokeWidth={1.75} />
              Back to the Grid
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={loading || unmappedSymbols.length > 0}
              onClick={handleValidate}
            >
              {loading ? 'Checking…' : 'Continue to Review'}
            </button>
          </div>
        </div>
      )}

      {step === 'review' && plan && (
        <div className="record-section">
          <h2>4. Review before importing</h2>

          <StatRow>
            <StatCard icon={Users} value={plan.summary.studentCount} label="Learners matched" />
            <StatCard icon={CalendarRange} value={datesToWrite} label="Days to import" />
            <StatCard icon={CheckCircle2} value={plan.summary.entryCount} label="Marks to write" variant="positive" />
            <StatCard
              icon={AlertTriangle}
              value={plan.conflicts.length}
              label="Days already recorded"
              variant={plan.conflicts.length > 0 ? 'warning' : undefined}
            />
          </StatRow>

          {plan.summary.firstDate && (
            <p style={{ color: 'var(--color-text-muted)' }}>
              Covers {plan.summary.firstDate} to {plan.summary.lastDate}
              {plan.summary.ignoredCells > 0 &&
                `. ${plan.summary.ignoredCells.toLocaleString()} cell${
                  plan.summary.ignoredCells === 1 ? '' : 's'
                } will not be imported (marks you set to "Don't import").`}
            </p>
          )}

          {/* The decision the import must never make on its own. Each of
              these days already has attendance on file — someone marked it —
              so overwriting it is a choice, taken one day at a time. The
              server refuses the import while any is undecided. */}
          {plan.conflicts.length > 0 && (
            <>
              <h3 style={{ marginTop: 'var(--space-5)' }}>Days that already have attendance</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>
                Someone has already recorded these days. Choose each one: overwrite it with what the sheet
                says, or leave the existing record alone and skip that day.
              </p>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Learners affected</th>
                      <th>What to do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.conflicts.map((conflict) => (
                      <tr key={conflict.date}>
                        <td>{conflict.date}</td>
                        <td>{conflict.studentCount}</td>
                        <td>
                          <select
                            value={conflictDecisions[conflict.date] || ''}
                            aria-label={`What to do about ${conflict.date}`}
                            onChange={(e) =>
                              setConflictDecisions((prev) => ({ ...prev, [conflict.date]: e.target.value }))
                            }
                          >
                            <option value="">-- Choose --</option>
                            <option value="overwrite">Overwrite with this sheet</option>
                            <option value="skip">Skip this day</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {undecidedConflicts.length > 0 && (
                <Alert variant="warning">
                  Still undecided: {undecidedConflicts.map((c) => c.date).join(', ')}
                </Alert>
              )}
            </>
          )}

          {plan.skipped.unknownStudents.length > 0 && (
            <>
              <h3 style={{ marginTop: 'var(--space-5)' }}>LRNs not in this {mode === 'subject' ? 'class' : 'section'}</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>
                These rows will not be imported. Either the LRN is mistyped, or the learner belongs to another{' '}
                {mode === 'subject' ? 'class' : 'section'} — in which case import that sheet separately rather
                than filing them here.
              </p>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Row in file</th>
                      <th>LRN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.skipped.unknownStudents.map((s) => (
                      <tr key={`${s.rowNumber}-${s.lrn}`}>
                        <td>{s.rowNumber}</td>
                        <td>
                          <code className="alert__code">{s.lrn}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {plan.skipped.duplicateStudents.length > 0 && (
            <>
              <h3 style={{ marginTop: 'var(--space-5)' }}>Learners listed more than once</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>
                Only the first row for each learner is imported. If the later row is the correct one, fix the
                sheet and import it again.
              </p>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Row in file</th>
                      <th>Learner</th>
                      <th>Already listed on row</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.skipped.duplicateStudents.map((s) => (
                      <tr key={`${s.rowNumber}-${s.lrn}`}>
                        <td>{s.rowNumber}</td>
                        <td>{s.name}</td>
                        <td>{s.firstRow}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {plan.skipped.datesWithoutPeriod.length > 0 && (
            <Alert variant="warning" title="Some days fall outside every grading period">
              {plan.skipped.datesWithoutPeriod.join(', ')} cannot be stored, because attendance is filed under
              a grading period and no configured period covers those dates. Check the month and year on the
              previous step, or add the period in Academic Setup first.
            </Alert>
          )}

          {plan.groups.length === 0 && (
            <Alert>Nothing in this sheet can be imported. The reasons are listed above.</Alert>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={() => setStep('symbols')}>
              <ArrowLeft size={16} strokeWidth={1.75} />
              Back to the Marks
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={loading || plan.groups.length === 0 || undecidedConflicts.length > 0 || datesToWrite === 0}
              onClick={handleCommit}
            >
              {loading
                ? 'Importing…'
                : `Import ${datesToWrite} Day${datesToWrite === 1 ? '' : 's'} of Attendance`}
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="record-section">
          {/* The Alert component, not a bare .alert div: .alert is a flex row
              (icon beside body), so loose <p> children become side-by-side
              columns instead of stacked paragraphs. */}
          <Alert
            variant="success"
            title={`Imported ${result.writtenCount.toLocaleString()} mark${
              result.writtenCount === 1 ? '' : 's'
            } across ${result.dateCount} day${result.dateCount === 1 ? '' : 's'} for ${
              result.studentCount
            } learner${result.studentCount === 1 ? '' : 's'}.`}
          >
            {result.recalculatedPeriods > 0 && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                Academic Progress Tracking was recalculated for {result.recalculatedPeriods} grading period
                {result.recalculatedPeriods === 1 ? '' : 's'} — the new attendance rates are already reflected
                there.
              </p>
            )}
            {mode === 'subject' && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                Subject attendance is supplementary and is not used in risk scoring, so nothing was
                recalculated.
              </p>
            )}
          </Alert>

          {(result.skippedDates.length > 0 ||
            result.skipped.unknownStudents.length > 0 ||
            result.skipped.duplicateStudents.length > 0 ||
            result.skipped.datesWithoutPeriod.length > 0) && (
            <div className="record-section" style={{ marginTop: 'var(--space-4)' }}>
              <h3>
                <CircleSlash size={16} strokeWidth={1.75} /> What was left out
              </h3>
              <ul>
                {result.skippedDates.length > 0 && (
                  <li>
                    {result.skippedDates.join(', ')} — already recorded, and you chose to keep the existing
                    record.
                  </li>
                )}
                {result.skipped.unknownStudents.length > 0 && (
                  <li>
                    {result.skipped.unknownStudents.length} row
                    {result.skipped.unknownStudents.length === 1 ? '' : 's'} whose LRN is not in this{' '}
                    {mode === 'subject' ? 'class' : 'section'}.
                  </li>
                )}
                {result.skipped.duplicateStudents.length > 0 && (
                  <li>
                    {result.skipped.duplicateStudents.length} duplicate row
                    {result.skipped.duplicateStudents.length === 1 ? '' : 's'} — the first one for each learner
                    was imported.
                  </li>
                )}
                {result.skipped.datesWithoutPeriod.length > 0 && (
                  <li>{result.skipped.datesWithoutPeriod.join(', ')} — outside every grading period.</li>
                )}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={resetAll}>
              Import Another File
            </button>
            <Link to={mode === 'subject' ? '/attendance/subject' : '/attendance/daily'} className="btn-primary">
              <CalendarCheck size={16} strokeWidth={1.75} />
              {mode === 'subject' ? 'Go to Subject Attendance' : 'Go to Daily Attendance'}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
