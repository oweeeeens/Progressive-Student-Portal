import { useEffect, useState } from 'react'
import { Plus, Search, BookOpen, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { DataTable, fieldValue } from '../components/table/DataTable'

const PAGE_SIZE = 15
const emptyForm = { name: '', code: '', gradeLevel: '' }

// Admin-only Academic Setup page for subjects. Like sections, subjects are
// soft-deactivated, never hard-deleted — one with grades recorded against
// it, or with an active class offering still assigned, can't be deactivated.
export function SubjectsPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  // null, not 0: until the count request answers there is no number to
  // show, and a failed request must not be reported as "none".
  const [activeTotal, setActiveTotal] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

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
  useEffect(load, [page, search, includeInactive])

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
    setError(null)
    setSaving(true)
    const payload = { name: form.name, code: form.code || null, gradeLevel: form.gradeLevel ? Number(form.gradeLevel) : null }
    try {
      if (editingId) {
        await api.put(`/subjects/${editingId}`, payload)
      } else {
        await api.post('/subjects', payload)
      }
      setShowForm(false)
      load()
      loadStats()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(row) {
    setError(null)
    try {
      await api.post(`/subjects/${row.id}/${row.is_active ? 'deactivate' : 'reactivate'}`)
      load()
      loadStats()
    } catch (err) {
      setError(err.message)
    }
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
          <button type="button" className="btn-primary" onClick={startCreate}>
            <Plus size={16} strokeWidth={1.75} />
            New Subject
          </button>
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
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Subject'}
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
        rowActions={(r) => [
          { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => startEdit(r) },
          r.is_active
            ? { key: 'deactivate', label: 'Deactivate', icon: XCircle, danger: true, onSelect: () => handleToggleActive(r) }
            : { key: 'reactivate', label: 'Reactivate', icon: CheckCircle2, onSelect: () => handleToggleActive(r) },
        ]}
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
