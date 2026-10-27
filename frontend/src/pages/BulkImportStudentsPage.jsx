import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Download, Upload, CheckCircle2, XCircle, ArrowLeft, Users } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { Alert } from '../components/Alert'
import { SpotIllustration } from '../components/illustrations/SpotIllustration'

// The step name is held as plain component state rather than a route — the
// parsed spreadsheet data only matters within one import attempt and never
// needs a URL of its own (refreshing mid-import is meant to start over, not
// resume).
const IMPORT_STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'mapping', label: 'Match columns' },
  { key: 'preview', label: 'Review' },
  { key: 'result', label: 'Done' },
]

export function BulkImportStudentsPage() {
  const [step, setStep] = useState('upload')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // What /parse returns: the raw parsed rows stay in memory for the rest of
  // this flow (re-sent to /validate and, for the valid subset, to /commit)
  // — see backend/controllers/bulkImportController.js's header comment on
  // why this whole feature is deliberately stateless server-side.
  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [fields, setFields] = useState([])
  const [mapping, setMapping] = useState({})

  const [validRows, setValidRows] = useState([])
  const [invalidRows, setInvalidRows] = useState([])

  // Rows the validator pre-filled isAlsGraduate on by matching free text.
  // Kept as a derived list rather than separate state so ticking a box only
  // ever edits the one source of truth (validRows) that gets committed.
  const rowsNeedingConfirmation = validRows.filter((r) => r.needsConfirmation?.length > 0)

  function setAlsConfirmed(rowNumber, confirmed) {
    setValidRows((rows) =>
      rows.map((r) => (r.rowNumber === rowNumber ? { ...r, data: { ...r.data, isAlsGraduate: confirmed } } : r))
    )
  }
  const [summary, setSummary] = useState(null)

  const [result, setResult] = useState(null)
  const [accountResult, setAccountResult] = useState(null) // { created, failures } | null
  const [creatingAccounts, setCreatingAccounts] = useState(false)

  function resetAll() {
    setStep('upload')
    setFileName('')
    setColumns([])
    setRows([])
    setFields([])
    setMapping({})
    setValidRows([])
    setInvalidRows([])
    setSummary(null)
    setResult(null)
    setAccountResult(null)
    setError(null)
  }

  async function handleDownloadTemplate() {
    try {
      await api.downloadFile('/students/bulk-import/template', 'student-import-template.xlsx')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files[0]
    e.target.value = '' // lets choosing the exact same file again still fire onChange
    if (!file) return

    setLoading(true)
    setError(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const data = await api.upload('/students/bulk-import/parse', formData)
      setFileName(data.fileName)
      setColumns(data.columns)
      setRows(data.rows)
      setFields(data.fields)
      setMapping(data.suggestedMapping)
      setStep('mapping')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleMappingChange(fieldKey, columnHeader) {
    setMapping((prev) => ({ ...prev, [fieldKey]: columnHeader || null }))
  }

  const missingRequiredFields = fields.filter((f) => f.required && !mapping[f.key])

  async function handleValidate() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.post('/students/bulk-import/validate', { rows, mapping })
      setValidRows(data.validRows)
      setInvalidRows(data.invalidRows)
      setSummary(data.summary)
      setStep('preview')
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
      const data = await api.post('/students/bulk-import/commit', {
        rows: validRows,
        mapping,
        fileName,
        totalRows: rows.length,
      })
      setResult(data)
      setStep('result')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Reuses the same bulk account-creation endpoint User Management's
  // "Pending Student Accounts" tab uses — the rows just imported are simply
  // a pre-selected subset (those with an email mapped), not a separate flow.
  async function handleCreateAccounts() {
    setError(null)
    setCreatingAccounts(true)
    try {
      const data = await api.post('/users/bulk-create-student-accounts', { studentIds: result.insertedIds })
      setAccountResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingAccounts(false)
    }
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Students', to: '/students' }, { label: 'Bulk Import' }]} />

      <div className="page-header">
        <h1>Bulk Import Students</h1>
      </div>

      {/* Where you are in the import. The flow has always had four stages
          held in component state, but nothing on screen said so — you found
          out there was a mapping step by arriving at it. Read-only, unlike
          the student form's: you cannot jump to Review before a file has
          been read. */}
      <ol className="form-steps form-steps--static">
        {IMPORT_STEPS.map((s, index) => {
          const current = IMPORT_STEPS.findIndex((x) => x.key === step)
          return (
            <li className="form-steps__item" key={s.key}>
              {index > 0 && <span className={`form-steps__connector${index <= current ? ' is-done' : ''}`} />}
              <span
                className={`form-steps__step${index === current ? ' is-active' : ''}${
                  index < current ? ' is-done' : ''
                }`}
                aria-current={index === current ? 'step' : undefined}
              >
                <span className="form-steps__index">
                  {index < current ? <Check size={14} strokeWidth={2} /> : index + 1}
                </span>
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>

      {error && (
        <Alert>{error}</Alert>
      )}

      {step === 'upload' && (
        <div className="panel import-upload">
          <SpotIllustration name="roster" />
          <h2>Upload a spreadsheet</h2>
          <p className="form-note">
            An .xlsx file with your students' records. Any column layout works — you'll match your columns
            to our fields on the next step.
          </p>
          <div className="import-upload__actions">
            <button type="button" onClick={handleDownloadTemplate}>
              <Download size={16} strokeWidth={1.75} />
              Download Template
            </button>
            <label className="btn-primary import-upload__file">
              <Upload size={16} strokeWidth={1.75} />
              {loading ? 'Uploading…' : 'Choose File'}
              <input
                type="file"
                accept=".xlsx"
                onChange={handleFileSelected}
                disabled={loading}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <div className="record-section">
          <h2>2. Match your columns to our fields</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>
            {fileName} — {rows.length} row{rows.length === 1 ? '' : 's'} found. Fields marked{' '}
            <strong>required</strong> must be mapped before continuing.
          </p>

          <div className="table-card" style={{ marginTop: 'var(--space-3)' }}>
            <table>
              <thead>
                <tr>
                  <th>Our field</th>
                  <th>Maps to column in your file</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr key={field.key}>
                    <td>
                      {field.label}
                      {field.required && <span className="required-mark"> *</span>}
                    </td>
                    <td>
                      <select
                        value={mapping[field.key] || ''}
                        onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      >
                        <option value="">-- Not mapped --</option>
                        {columns.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missingRequiredFields.length > 0 && (
            <Alert variant="warning">
              Still need to map: {missingRequiredFields.map((f) => f.label).join(', ')}
            </Alert>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={resetAll}>
              <ArrowLeft size={16} strokeWidth={1.75} />
              Start Over
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={missingRequiredFields.length > 0 || loading}
              onClick={handleValidate}
            >
              {loading ? 'Checking…' : 'Continue to Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && summary && (
        <div className="record-section">
          <h2>3. Review before importing</h2>

          <StatRow>
            <StatCard icon={CheckCircle2} value={summary.validCount} label="Rows ready to import" variant="positive" />
            <StatCard icon={XCircle} value={summary.invalidCount} label="Rows with errors (skipped)" variant="negative" />
          </StatRow>

          {/* Rows where "ALS" was matched in free-text last-school data.
              These ARE valid and WILL import — the flag just isn't trusted,
              because the column is prose a clerk typed. Each row is shown
              with the text that triggered it and a checkbox, so confirming
              is a glance rather than a separate cleanup pass. */}
          {rowsNeedingConfirmation.length > 0 && (
            <>
              <h3 style={{ marginTop: 'var(--space-5)' }}>Confirm detected ALS graduates</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>
                "Last School Attended" is free text, so these are matches rather than facts. Untick any row that
                isn't actually an ALS graduate — everything else about these rows imports either way.
              </p>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Why it was flagged</th>
                      <th>ALS graduate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsNeedingConfirmation.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>{[row.data.firstName, row.data.lastName].filter(Boolean).join(' ') || '—'}</td>
                        <td>{row.needsConfirmation.map((c) => c.message).join(' ')}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.data.isAlsGraduate === true}
                            aria-label={`Confirm row ${row.rowNumber} is an ALS graduate`}
                            onChange={(e) => setAlsConfirmed(row.rowNumber, e.target.checked)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {invalidRows.length > 0 && (
            <>
              <h3 style={{ marginTop: 'var(--space-5)' }}>Rows that will be skipped</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>
                Fix these in your source file and re-upload just the corrected rows, or continue — only the
                rows above will be imported now.
              </p>
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invalidRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>
                          {[row.data.firstName, row.data.lastName].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td>
                          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
                            {row.errors.map((e, i) => (
                              <li key={i}>
                                <strong>{e.field}:</strong> {e.message}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={() => setStep('mapping')}>
              <ArrowLeft size={16} strokeWidth={1.75} />
              Back to Mapping
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={summary.validCount === 0 || loading}
              onClick={handleCommit}
            >
              {loading ? 'Importing…' : `Import ${summary.validCount} Student${summary.validCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="record-section">
          {/* The Alert component, not a bare .alert div: .alert is a flex
              row (icon beside body), so loose <p> children lay out as
              side-by-side columns instead of stacked paragraphs. */}
          <Alert
            variant="success"
            title={`Imported ${result.insertedCount} student${result.insertedCount === 1 ? '' : 's'} successfully.`}
          >
            {result.failures.length > 0 && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                {result.failures.length} row{result.failures.length === 1 ? '' : 's'} failed unexpectedly while
                saving — see below.
              </p>
            )}
          </Alert>

          {result.failures.length > 0 && (
            <div className="table-card" style={{ marginTop: 'var(--space-3)' }}>
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.failures.map((f) => (
                    <tr key={f.rowNumber}>
                      <td>{f.rowNumber}</td>
                      <td>{f.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.insertedIds.length > 0 && !accountResult && (
            <div className="record-section" style={{ marginTop: 'var(--space-4)' }}>
              <h3>Create portal accounts?</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>
                {result.insertedIds.length} of the imported students had an email on file and don't have a portal
                account yet. You can create their logins now, or do it later from User Management.
              </p>
              <button type="button" className="btn-primary" onClick={handleCreateAccounts} disabled={creatingAccounts}>
                <Users size={16} strokeWidth={1.75} />
                {creatingAccounts ? 'Creating…' : `Create ${result.insertedIds.length} Account${result.insertedIds.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}

          {accountResult && (
            <Alert
              variant="success"
              className="alert--block"
              title={`Created ${accountResult.created.length} account${
                accountResult.created.length === 1 ? '' : 's'
              }${accountResult.failures.length > 0 ? `, ${accountResult.failures.length} failed` : ''}.`}
            >
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                Share each temporary password with that student now — they will not be shown again.
              </p>
              {accountResult.created.length > 0 && (
                <div className="table-card" style={{ marginTop: 'var(--space-3)' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Email</th>
                        <th>Temporary Password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountResult.created.map((c) => (
                        <tr key={c.studentId}>
                          <td>{c.studentName}</td>
                          <td>{c.email}</td>
                          <td>
                            <code className="alert__code">{c.tempPassword}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Alert>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={resetAll}>
              Import Another File
            </button>
            <Link to="/students" className="btn-primary">
              <Users size={16} strokeWidth={1.75} />
              Go to Students
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
