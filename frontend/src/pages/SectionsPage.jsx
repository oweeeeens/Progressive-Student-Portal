import { useEffect, useState } from 'react'
import { Plus, Layers, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { canManageAcademicSetup } from '../utils/permissions'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import { Alert } from '../components/Alert'
import { Modal } from '../components/Modal'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { TableToolbar } from '../components/table/TableToolbar'
import { useWriteFeedback } from '../hooks/useWriteFeedback'
import { useConfirm } from '../hooks/useConfirm'

const PAGE_SIZE = 15
// Either teaching role can hold either assignment, because that is how the
// school works: a teacher commonly advises one section and teaches subjects
// to other sections. Nothing in the database or in any permission check ever
// forbade it — `sections.adviser_id` and `class_offerings.teacher_id` are
// plain user references, and every write guard asks who is assigned rather
// than what the role column says. These two dropdowns were the only thing
// making the arrangement impossible to set up.
const ASSIGNABLE_TEACHING_ROLES = ['adviser', 'subject_teacher']

const emptyForm = { schoolYearId: '', gradeLevel: 11, strand: '', name: '', adviserId: '' }

// Admin-only Academic Setup page for advisory sections. Sections are
// soft-deactivated, never hard-deleted (see the is-active migration) — a
// section with grades or attendance already recorded against it can't be
// deactivated, since every other module keys off its id.
export function SectionsPage() {
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
  const [advisers, setAdvisers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  // Failures, confirmations and the in-flight guard for every write on this
  // page. Before this, a successful save closed the form and refetched and
  // said nothing at all — so on a page whose only other message is an error,
  // silence was how the user learned it had worked. The keyed busy flag also
  // stops a double-click sending the same write twice.
  const { error, setError, busyKey, runWrite } = useWriteFeedback()
  const [confirm, confirmDialog] = useConfirm()

  useEffect(() => {
    api.get('/school-years').then((data) => setSchoolYears(data.schoolYears))
    // Only for someone who can actually create or edit. /users is admin and
    // registrar only, so a read-only principal asking for it gets a 403 —
    // and the list exists purely to fill a form they never open.
    if (canWrite) {
      api.get('/users').then((data) => setAdvisers(data.users.filter((u) => ASSIGNABLE_TEACHING_ROLES.includes(u.role))))
    }
  }, [canWrite, setError])

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
      gradeLevel: row.grade_level,
      strand: row.strand || '',
      name: row.name,
      adviserId: String(row.adviser_id),
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const wasEdit = Boolean(editingId)
    const payload = {
      schoolYearId: Number(form.schoolYearId),
      gradeLevel: Number(form.gradeLevel),
      strand: form.strand || null,
      name: form.name,
      adviserId: Number(form.adviserId),
    }
    await runWrite(
      'form',
      async () => {
        if (editingId) {
          await api.put(`/sections/${editingId}`, payload)
        } else {
          await api.post('/sections', payload)
        }
        setShowForm(false)
        load()
        loadStats()
      },
      `${form.name} ${wasEdit ? 'updated' : 'created'}.`
    )
  }

  async function handleToggleActive(row) {
    const deactivating = row.is_active
    // Reactivating is harmless and stays one click; deactivating asks first.
    if (
      deactivating &&
      !(await confirm({
        title: 'Deactivate this section?',
        message: `${row.name} will be deactivated and will no longer appear in the lists and pickers that use active sections. You can reactivate it at any time.`,
        confirmLabel: 'Deactivate',
        danger: true,
      }))
    ) {
      return
    }
    await runWrite(
      // Keyed on the row so only that row's actions are disabled while the
      // request is out, rather than freezing the whole table.
      row.id,
      async () => {
        await api.post(`/sections/${row.id}/${deactivating ? 'deactivate' : 'reactivate'}`)
        load()
        loadStats()
      },
      `${row.name} ${deactivating ? 'deactivated' : 'reactivated'}.`
    )
  }


  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Academic Setup' }, { label: 'Sections' }]} />

      <div className="page-header">
        <h1>Sections</h1>
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

      {/* Search, the inactive toggle and the create button sit in the same
          toolbar, in the same order, as on Students and User Management —
          they used to be crowded into this page's title row, so the three
          setup lists were the only list pages laid out differently. */}
      <TableToolbar
        search={search}
        onSearchChange={(value) => {
          setPage(1)
          setSearch(value)
        }}
        searchPlaceholder="Search by name or strand"
        filters={
          <label className="table-toolbar__filter">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => {
                setPage(1)
                setIncludeInactive(e.target.checked)
              }}
            />
            <span>Show inactive</span>
          </label>
        }
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={startCreate}>
              <Plus size={16} strokeWidth={1.75} />
              New Section
            </button>
          )
        }
      />

      {error && <Alert>{error}</Alert>}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? 'Edit Section' : 'New Section'}
      >
        <form onSubmit={handleSubmit} className="intervention-log-form">
          <div className="intervention-log-form__fields">
            <label htmlFor="section-school-year">School Year<span className="required-mark"> *</span></label>
            <select id="section-school-year"
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

            <label htmlFor="section-grade-level">Grade Level</label>
            <select id="section-grade-level" value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}>
              <option value={11}>Grade 11</option>
              <option value={12}>Grade 12</option>
            </select>

            <label htmlFor="section-strand">Strand (optional)</label>
            <input id="section-strand"
              value={form.strand}
              onChange={(e) => setForm((f) => ({ ...f, strand: e.target.value }))}
              placeholder="e.g. STEM"
            />

            <label htmlFor="section-section-name">Section Name<span className="required-mark"> *</span></label>
            <input id="section-section-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />

            <label htmlFor="section-adviser">Adviser<span className="required-mark"> *</span></label>
            <select id="section-adviser"
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
          <div className="button-row">
            <button type="submit" className="btn-primary" disabled={busyKey === 'form'}>
              {busyKey === 'form' ? 'Saving…' : editingId ? 'Save Changes' : 'Create Section'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

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
            <p>No sections yet.</p>
            <p>Create one to start assigning students and advisers.</p>
          </>
        }
      />

      {confirmDialog}
    </div>
  )
}
