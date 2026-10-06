import { useEffect, useState } from 'react'
import { Plus, Search, BookOpen, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'

const PAGE_SIZE = 15
const emptyForm = { name: '', code: '', gradeLevel: '' }

// Admin-only Academic Setup page for subjects. Like sections, subjects are
// soft-deactivated, never hard-deleted — one with grades recorded against
// it, or with an active class offering still assigned, can't be deactivated.
export function SubjectsPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [activeTotal, setActiveTotal] = useState(0)
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

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

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

      <StatRow>
        <StatCard icon={BookOpen} value={activeTotal} label="Active subjects" />
      </StatRow>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

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

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No subjects found.</p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Grade Level</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.code || '—'}</td>
                  <td>{r.grade_level || 'Both'}</td>
                  <td>
                    <StatusPill label={r.is_active ? 'active' : 'inactive'} variant={r.is_active ? 'positive' : 'neutral'} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button type="button" className="btn-subtle" onClick={() => startEdit(r)}>
                        <Pencil size={13} strokeWidth={1.75} /> Edit
                      </button>
                      <button type="button" className="btn-subtle" onClick={() => handleToggleActive(r)}>
                        {r.is_active ? (
                          <>
                            <XCircle size={13} strokeWidth={1.75} /> Deactivate
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={13} strokeWidth={1.75} /> Reactivate
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}
