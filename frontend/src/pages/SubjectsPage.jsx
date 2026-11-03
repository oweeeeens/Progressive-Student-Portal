import { useEffect, useState } from 'react'
import { Plus, Search, BookOpen, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { canManageAcademicSetup } from '../utils/permissions'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { useWriteFeedback } from '../hooks/useWriteFeedback'

const PAGE_SIZE = 15
const emptyForm = { name: '', code: '', gradeLevel: '' }

// Admin-only Academic Setup page for subjects. Like sections, subjects are
// soft-deactivated, never hard-deleted — one with grades recorded against
// it, or with an active class offering still assigned, can't be deactivated.
export function SubjectsPage() {
  // The principal reads these pages and changes nothing on them, so every
  // write control below is hidden rather than left to fail with a 403 the
  // page would show as a bare permission error.
  const { user } = useAuth()
  const canWrite = canManageAcademicSetup(user?.role)

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  // null, not 0: until the count request answers there is no number to
  // show, and a failed request must not be reported as "none".
  const [activeTotal, setActiveTotal] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  // Failures, confirmations and the in-flight guard for every write on this
  // page. Before this, a successful save closed the form and refetched and
  // said nothing at all — so on a page whose only other message is an error,
  // silence was how the user learned it had worked.
  const { error, setError, notice, busyKey, runWrite } = useWriteFeedback()

  function loadStats() {
    api.get('/subjects/admin?page=1&pageSize=1').then((data) => setActiveTotal(data.total))
  }
  useEffect(loadStats, [])

  function load() {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE, includeInactive: String(includeInactive) })
    if (search) params.set('search', search)
    api
      .get(`/subjects/admin?${params.toString()}`)
      .then((data) => {
        setRows(data.rows)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [page, search, includeInactive, setError])

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function startEdit(row) {
    setEditingId(row.id)
    setForm({ name: row.name, code: row.code || '', gradeLevel: row.grade_level || '' })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const payload = { name: form.name, code: form.code || null, gradeLevel: form.gradeLevel ? Number(form.gradeLevel) : null }
    const wasEdit = Boolean(editingId)

    await runWrite(
      'form',
      async () => {
        if (editingId) {
          await api.put(`/subjects/${editingId}`, payload)
        } else {
          await api.post('/subjects', payload)
        }
        setShowForm(false)
        load()
        loadStats()
      },
      // Names the subject back, so the confirmation is about the thing that
      // was saved rather than a generic "Saved" that could belong to any row.
      `${form.name} ${wasEdit ? 'updated' : 'created'}.`
    )
  }

  async function handleToggleActive(row) {
    const deactivating = row.is_active
    await runWrite(
      // Keyed on the row so only that row's actions are disabled while the
      // request is out, rather than freezing the whole table.
      row.id,
      async () => {
        await api.post(`/subjects/${row.id}/${deactivating ? 'deactivate' : 'reactivate'}`)
        load()
        loadStats()
      },
      `${row.name} ${deactivating ? 'deactivated' : 'reactivated'}.`
    )
  }


  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Academic Setup' }, { label: 'Subjects' }]} />

      <div className="page-header">
        <h1>Subjects</h1>
        <div className="page-header__actions">
          <div className="search-field">
            <Search size={16} strokeWidth={1.75} />
            <input
              type="search"
              placeholder="Search by name or code"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
            />
          </div>
          <label>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => {
                setPage(1)
                setIncludeInactive(e.target.checked)
              }}
              style={{ width: 'auto', marginRight: 'var(--space-1)' }}
            />
            Show inactive
          </label>
          {canWrite && (
            <button type="button" className="btn-primary" onClick={startCreate}>
              <Plus size={16} strokeWidth={1.75} />
              New Subject
            </button>
          )}
        </div>
      </div>

      {/* The count sits on the table it counts. A figures strip holding
          one tile is the marooned single card that was taken off Verify
          and Finalize Grades for the same reason. */}
      <p className="live-summary-bar">
        <BookOpen size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="live-summary-bar__lead">
          {activeTotal} active subjects
        </span>
      </p>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {showForm && (
        <form onSubmit={handleSubmit} className="intervention-log-form">
          <h3>{editingId ? 'Edit Subject' : 'New Subject'}</h3>
          <div className="intervention-log-form__fields">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />

            <label>Code (optional)</label>
            <input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. MATH11"
            />

            <label>Grade Level (optional)</label>
            <select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}>
              <option value="">Offered in both grade levels</option>
              <option value={11}>Grade 11</option>
              <option value={12}>Grade 12</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="submit" className="btn-primary" disabled={busyKey === 'form'}>
              {busyKey === 'form' ? 'Saving…' : editingId ? 'Save Changes' : 'Create Subject'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <DataTable
        loading={loading}
        error={error}
        columns={[
          { key: 'name', header: 'Name', primary: true, plainText: (r) => r.name, render: (r) => r.name },
          { key: 'code', header: 'Code', render: (r) => fieldValue(r.code) },
          { key: 'level', header: 'Grade Level', render: (r) => r.grade_level || 'Both' },
          {
            key: 'status',
            header: 'Status',
            uniformValue: (r) => String(r.is_active),
            quietValue: 'true',
            render: (r) => (
              <StatusPill label={r.is_active ? 'active' : 'inactive'} variant={r.is_active ? 'positive' : 'neutral'} />
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        rowActions={(r) => (!canWrite ? [] : [
          { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => startEdit(r) },
          r.is_active
            ? {
                key: 'deactivate',
                label: 'Deactivate',
                icon: XCircle,
                danger: true,
                disabled: busyKey === r.id,
                onSelect: () => handleToggleActive(r),
              }
            : {
                key: 'reactivate',
                label: 'Reactivate',
                icon: CheckCircle2,
                disabled: busyKey === r.id,
                onSelect: () => handleToggleActive(r),
              },
        ])}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyState={
          <>
            <p>No subjects yet.</p>
            <p>Add one to start building class offerings.</p>
          </>
        }
      />

    </div>
  )
}
