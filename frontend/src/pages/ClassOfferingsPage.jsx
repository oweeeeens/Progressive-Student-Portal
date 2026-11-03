import { useEffect, useState } from 'react'
import { Plus, Search, BookMarked, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { canManageAcademicSetup } from '../utils/permissions'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { useWriteFeedback } from '../hooks/useWriteFeedback'
import { CLASS_TERMS, CLASS_TERM_SHORT } from '../utils/academicTerms'

const PAGE_SIZE = 15
// Either teaching role can hold either assignment, because that is how the
// school works: a teacher commonly advises one section and teaches subjects
// to other sections. Nothing in the database or in any permission check ever
// forbade it — `sections.adviser_id` and `class_offerings.teacher_id` are
// plain user references, and every write guard asks who is assigned rather
// than what the role column says. These two dropdowns were the only thing
// making the arrangement impossible to set up.
const ASSIGNABLE_TEACHING_ROLES = ['adviser', 'subject_teacher']

// 'full_year' is the default because it is what every class recorded before
// this field existed means, and what a Grade 11 class is.
const emptyForm = { schoolYearId: '', sectionId: '', subjectId: '', teacherId: '', term: 'full_year' }

// Admin-only Academic Setup page assigning "this teacher teaches this
// subject to this section this school year." Soft-deactivated, never
// hard-deleted — one with grades already recorded against it can't be
// deactivated (grade history must keep pointing at a real class offering).
export function ClassOfferingsPage() {
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
  const [schoolYears, setSchoolYears] = useState([])
  const [sections, setSections] = useState([])
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  // Failures, confirmations and the in-flight guard for every write on this
  // page. Before this, a successful save closed the form and refetched and
  // said nothing at all — so on a page whose only other message is an error,
  // silence was how the user learned it had worked. The keyed busy flag also
  // stops a double-click sending the same write twice.
  const { error, setError, notice, busyKey, runWrite } = useWriteFeedback()

  useEffect(() => {
    api.get('/school-years').then((data) => setSchoolYears(data.schoolYears))
    api.get('/sections').then((data) => setSections(data.sections))
    api.get('/subjects').then((data) => setSubjects(data.subjects))
    // Only for someone who can actually create or edit. /users is admin and
    // registrar only, so a read-only principal asking for it gets a 403 —
    // and the list exists purely to fill a form they never open.
    if (canWrite) {
      api.get('/users').then((data) => setTeachers(data.users.filter((u) => ASSIGNABLE_TEACHING_ROLES.includes(u.role))))
    }
  }, [canWrite, setError])

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
  useEffect(load, [page, search, includeInactive, setError])

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
      term: row.term || 'full_year',
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const wasEdit = Boolean(editingId)
    const payload = {
      schoolYearId: Number(form.schoolYearId),
      sectionId: Number(form.sectionId),
      subjectId: Number(form.subjectId),
      teacherId: Number(form.teacherId),
      term: form.term,
    }
    await runWrite(
      'form',
      async () => {
        if (editingId) {
          await api.put(`/class-offerings/${editingId}`, payload)
        } else {
          await api.post('/class-offerings', payload)
        }
        setShowForm(false)
        load()
        loadStats()
      },
      `Class offering ${wasEdit ? 'updated' : 'created'}.`
    )
  }

  async function handleToggleActive(row) {
    const deactivating = row.is_active
    await runWrite(
      // Keyed on the row so only that row's actions are disabled while the
      // request is out, rather than freezing the whole table.
      row.id,
      async () => {
        await api.post(`/class-offerings/${row.id}/${deactivating ? 'deactivate' : 'reactivate'}`)
        load()
        loadStats()
      },
      `${row.subject_name} in ${row.section_name} ${deactivating ? 'deactivated' : 'reactivated'}.`
    )
  }


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
          {canWrite && (
            <button type="button" className="btn-primary" onClick={startCreate}>
              <Plus size={16} strokeWidth={1.75} />
              New Class Offering
            </button>
          )}
        </div>
      </div>

      {/* The count sits on the table it counts. A figures strip holding
          one tile is the marooned single card that was taken off Verify
          and Finalize Grades for the same reason. */}
      <p className="live-summary-bar">
        <BookMarked size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="live-summary-bar__lead">
          {activeTotal} active class offerings
        </span>
      </p>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

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

            {/* How long this class runs. A Grade 11 class runs all year; a
                Grade 12 core or applied class changes each semester, so the
                same subject can be offered to the same section twice in one
                year — which is why the uniqueness constraint now includes
                this field. */}
            <label htmlFor="offering-term">Runs for</label>
            <select
              id="offering-term"
              value={form.term}
              onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
            >
              {CLASS_TERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {form.term !== 'full_year' && (
              <p className="form-note" style={{ gridColumn: '1 / -1', margin: 0 }}>
                This class shows up only in the quarters assigned to that semester. Assign each quarter its semester
                under Academic Setup → School Years.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="submit" className="btn-primary" disabled={busyKey === 'form'}>
              {busyKey === 'form' ? 'Saving…' : editingId ? 'Save Changes' : 'Create Class Offering'}
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
            key: 'subject',
            header: 'Subject',
            primary: true,
            plainText: (r) => r.subject_name,
            render: (r) => r.subject_name,
          },
          {
            key: 'section',
            header: 'Section',
            render: (r) => `Grade ${r.grade_level} - ${r.section_name}`,
          },
          { key: 'teacher', header: 'Teacher', truncate: true, plainText: (r) => r.teacher_name, render: (r) => fieldValue(r.teacher_name) },
          { key: 'year', header: 'School Year', uniformValue: (r) => r.school_year_label, render: (r) => r.school_year_label },
          {
            key: 'term',
            header: 'Runs for',
            // The quiet value is the whole year, so only a class that stops
            // at a semester draws the eye — which is the exception worth
            // seeing in a list of mostly full-year classes.
            uniformValue: (r) => r.term,
            quietValue: 'full_year',
            render: (r) => CLASS_TERM_SHORT[r.term] || fieldValue(r.term),
          },
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
            <p>No class offerings yet.</p>
            <p>A class offering is one subject taught to one section — create one so a teacher can enter grades.</p>
          </>
        }
      />

    </div>
  )
}
