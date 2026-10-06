import { useEffect, useState } from 'react'
import { Plus, Search, BookMarked, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'

const PAGE_SIZE = 15
const emptyForm = { schoolYearId: '', sectionId: '', subjectId: '', teacherId: '' }

// Admin-only Academic Setup page assigning "this teacher teaches this
// subject to this section this school year." Soft-deactivated, never
// hard-deleted — one with grades already recorded against it can't be
// deactivated (grade history must keep pointing at a real class offering).
export function ClassOfferingsPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [activeTotal, setActiveTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [schoolYears, setSchoolYears] = useState([])
  const [sections, setSections] = useState([])
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/school-years').then((data) => setSchoolYears(data.schoolYears))
    api.get('/sections').then((data) => setSections(data.sections))
    api.get('/subjects').then((data) => setSubjects(data.subjects))
    api.get('/users').then((data) => setTeachers(data.users.filter((u) => u.role === 'subject_teacher')))
  }, [])

  function loadStats() {
    api.get('/class-offerings/admin?page=1&pageSize=1').then((data) => setActiveTotal(data.total))
  }
  useEffect(loadStats, [])

  function load() {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE, includeInactive: String(includeInactive) })
    if (search) params.set('search', search)
    api
      .get(`/class-offerings/admin?${params.toString()}`)
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
      sectionId: String(row.section_id),
      subjectId: String(row.subject_id),
      teacherId: String(row.teacher_id),
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const payload = {
      schoolYearId: Number(form.schoolYearId),
      sectionId: Number(form.sectionId),
      subjectId: Number(form.subjectId),
      teacherId: Number(form.teacherId),
    }
    try {
      if (editingId) {
        await api.put(`/class-offerings/${editingId}`, payload)
      } else {
        await api.post('/class-offerings', payload)
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
      await api.post(`/class-offerings/${row.id}/${row.is_active ? 'deactivate' : 'reactivate'}`)
      load()
      loadStats()
    } catch (err) {
      setError(err.message)
    }
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Academic Setup' }, { label: 'Class Offerings' }]} />

      <div className="page-header">
        <h1>Class Offerings</h1>
        <div className="page-header__actions">
          <div className="search-field">
            <Search size={16} strokeWidth={1.75} />
            <input
              type="search"
              placeholder="Search by subject, section, or teacher"
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
            New Class Offering
          </button>
        </div>
      </div>

      <StatRow>
        <StatCard icon={BookMarked} value={activeTotal} label="Active class offerings" />
      </StatRow>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {showForm && (
        <form onSubmit={handleSubmit} className="intervention-log-form">
          <h3>{editingId ? 'Edit Class Offering' : 'New Class Offering'}</h3>
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

            <label>Section</label>
            <select
              value={form.sectionId}
              onChange={(e) => setForm((f) => ({ ...f, sectionId: e.target.value }))}
              required
            >
              <option value="">-- select --</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Grade {s.grade_level} - {s.name}
                </option>
              ))}
            </select>

            <label>Subject</label>
            <select
              value={form.subjectId}
              onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
              required
            >
              <option value="">-- select --</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <label>Teacher</label>
            <select
              value={form.teacherId}
              onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}
              required
            >
              <option value="">-- select --</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Class Offering'}
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
          <p>No class offerings found.</p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Section</th>
                <th>Teacher</th>
                <th>School Year</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.subject_name}</td>
                  <td>
                    Grade {r.grade_level} - {r.section_name}
                  </td>
                  <td>{r.teacher_name}</td>
                  <td>{r.school_year_label}</td>
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
