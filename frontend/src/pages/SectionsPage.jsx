import { useEffect, useState } from 'react'
import { Plus, Search, Layers, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { DataTable, fieldValue } from '../components/table/DataTable'

const PAGE_SIZE = 15
const emptyForm = { schoolYearId: '', gradeLevel: 11, strand: '', name: '', adviserId: '' }

// Admin-only Academic Setup page for advisory sections. Sections are
// soft-deactivated, never hard-deleted (see the is-active migration) — a
// section with grades or attendance already recorded against it can't be
// deactivated, since every other module keys off its id.
export function SectionsPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  // null, not 0: until the count request answers there is no number to
  // show, and a failed request must not be reported as "none".
  const [activeTotal, setActiveTotal] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [schoolYears, setSchoolYears] = useState([])
  const [advisers, setAdvisers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/school-years').then((data) => setSchoolYears(data.schoolYears))
    api.get('/users').then((data) => setAdvisers(data.users.filter((u) => u.role === 'adviser')))
  }, [])

  function loadStats() {
    api.get('/sections/admin?page=1&pageSize=1').then((data) => setActiveTotal(data.total))
  }
  useEffect(loadStats, [])

  function load() {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE, includeInactive: String(includeInactive) })
    if (search) params.set('search', search)
    api
      .get(`/sections/admin?${params.toString()}`)
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
    const current = schoolYears.find((sy) => sy.is_current)
    setForm({ ...emptyForm, schoolYearId: current ? String(current.id) : '' })
    setShowForm(true)
  }

  function startEdit(row) {
    setEditingId(row.id)
    setForm({
      schoolYearId: String(row.school_year_id),
      gradeLevel: row.grade_level,
      strand: row.strand || '',
      name: row.name,
      adviserId: String(row.adviser_id),
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const payload = {
      schoolYearId: Number(form.schoolYearId),
      gradeLevel: Number(form.gradeLevel),
      strand: form.strand || null,
      name: form.name,
      adviserId: Number(form.adviserId),
    }
    try {
      if (editingId) {
        await api.put(`/sections/${editingId}`, payload)
      } else {
        await api.post('/sections', payload)
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
      await api.post(`/sections/${row.id}/${row.is_active ? 'deactivate' : 'reactivate'}`)
      load()
      loadStats()
    } catch (err) {
      setError(err.message)
    }
  }


  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Academic Setup' }, { label: 'Sections' }]} />

      <div className="page-header">
        <h1>Sections</h1>
        <div className="page-header__actions">
          <div className="search-field">
            <Search size={16} strokeWidth={1.75} />
            <input
              type="search"
              placeholder="Search by name or strand"
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
            New Section
          </button>
        </div>
      </div>

      {/* The count sits on the table it counts. A figures strip holding
          one tile is the marooned single card that was taken off Verify
          and Finalize Grades for the same reason. */}
      <p className="live-summary-bar">
        <Layers size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="live-summary-bar__lead">
          {activeTotal} active sections
        </span>
      </p>

      {error && <Alert>{error}</Alert>}

      {showForm && (
        <form onSubmit={handleSubmit} className="intervention-log-form">
          <h3>{editingId ? 'Edit Section' : 'New Section'}</h3>
          <div className="intervention-log-form__fields">
            <label>School Year</label>
            <select
              value={form.schoolYearId}
              onChange={(e) => setForm((f) => ({ ...f, schoolYearId: e.target.value }))}
              required
            >
              <option value="">-- select --</option>
              {schoolYears.map((sy) => (
                <option key={sy.id} value={sy.id}>
                  {sy.label} {sy.is_current ? '(current)' : ''}
                </option>
              ))}
            </select>

            <label>Grade Level</label>
            <select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}>
              <option value={11}>Grade 11</option>
              <option value={12}>Grade 12</option>
            </select>

            <label>Strand (optional)</label>
            <input
              value={form.strand}
              onChange={(e) => setForm((f) => ({ ...f, strand: e.target.value }))}
              placeholder="e.g. STEM"
            />

            <label>Section Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />

            <label>Adviser</label>
            <select
              value={form.adviserId}
              onChange={(e) => setForm((f) => ({ ...f, adviserId: e.target.value }))}
              required
            >
              <option value="">-- select --</option>
              {advisers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Section'}
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
          {
            key: 'section',
            header: 'Section',
            primary: true,
            plainText: (r) => `Grade ${r.grade_level} - ${r.name}`,
            render: (r) => `Grade ${r.grade_level} - ${r.name}`,
          },
          { key: 'strand', header: 'Strand', render: (r) => fieldValue(r.strand) },
          // One school year on screen at a time in practice, so this
          // usually lifts out into the line above the table.
          { key: 'year', header: 'School Year', uniformValue: (r) => r.school_year_label, render: (r) => r.school_year_label },
          { key: 'adviser', header: 'Adviser', truncate: true, plainText: (r) => r.adviser_name, render: (r) => fieldValue(r.adviser_name) },
          {
            key: 'status',
            header: 'Status',
            uniformValue: (r) => String(r.is_active),
            // An active section is the ordinary case; a deactivated one is
            // what someone scanning this list is looking for.
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
            <p>No sections yet.</p>
            <p>Create one to start assigning students and advisers.</p>
          </>
        }
      />

    </div>
  )
}
