import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus,
  Search,
  Users,
  UserX,
  Clock,
  KeyRound,
  Pencil,
  Power,
  UserPlus,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { Pagination } from '../components/Pagination'
import { Tabs } from '../components/Tabs'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { TableToolbar, TableFilter } from '../components/table/TableToolbar'
import { Alert } from '../components/Alert'

const PAGE_SIZE = 15

// 'admin' is deliberately excluded — it's never handed out or reassigned
// through a web form (see config/auth.js's CREATABLE_ROLES), so it has no
// place in a role *filter or edit* picker either.
const ROLE_LABELS = {
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  registrar: 'Registrar',
  principal: 'Principal',
  ict_faculty: 'ICT Faculty',
  student: 'Student',
}
// The admin account(s) still need to display correctly in the roster even
// though they're excluded from the filter/edit pickers above.
const ROLE_DISPLAY_LABELS = { admin: 'Admin', ...ROLE_LABELS }

function AccountStatusCell({ account }) {
  if (!account.is_active) return <StatusPill label="inactive" variant="neutral" />
  if (account.must_change_password) return <StatusPill label="pending first login" variant="warning" />
  return <StatusPill label="active" variant="positive" />
}

// Tab 1: every real login (staff and students), searchable/filterable by
// role, status, and section/class assignment, with inline edit and
// activate/deactivate — the expanded replacement for the old Staff Accounts
// list, which only ever showed non-student roles.
function AllAccountsTab() {
  const { user: currentUser } = useAuth()
  const [accounts, setAccounts] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [sections, setSections] = useState([])
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ fullName: '', email: '', role: '' })
  const [saving, setSaving] = useState(false)

  const [resetResult, setResetResult] = useState(null) // { email, tempPassword } | null
  const [resettingId, setResettingId] = useState(null)

  useEffect(() => {
    api.get('/sections').then((data) => setSections(data.sections)).catch(() => {})
  }, [])

  function loadStats() {
    api
      .get('/users/accounts/stats')
      .then((data) => setCounts(data.counts))
      .catch((err) => setError(err.message))
  }
  useEffect(loadStats, [])

  function load() {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (search) params.set('search', search)
    if (role) params.set('role', role)
    if (status) params.set('status', status)
    if (sectionId) params.set('sectionId', sectionId)

    api
      .get(`/users/accounts?${params.toString()}`)
      .then((data) => {
        setAccounts(data.accounts)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [page, search, role, status, sectionId])

  function startEdit(account) {
    setResetResult(null)
    setEditingId(account.id)
    setEditForm({ fullName: account.full_name, email: account.email, role: account.role })
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.patch(`/users/${editingId}`, editForm)
      setEditingId(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(account) {
    setError(null)
    try {
      await api.patch(`/users/${account.id}/active`, { isActive: !account.is_active })
      load()
      loadStats()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleReset(account) {
    setError(null)
    setResetResult(null)
    setResettingId(account.id)
    try {
      const result = await api.post(`/users/${account.id}/reset-password`)
      setResetResult({ email: account.email, tempPassword: result.tempPassword })
    } catch (err) {
      setError(err.message)
    } finally {
      setResettingId(null)
    }
  }

  const filtersActive = Boolean(search || role || status || sectionId)

  function clearFilters() {
    setPage(1)
    setSearch('')
    setRole('')
    setStatus('')
    setSectionId('')
  }

  // Same rule as the roster: only tiles carrying distinct, non-obvious
  // information. Total always counts; "Active" is just total-minus-inactive
  // on a roster where almost everyone is active, so the exception states
  // are what's worth a tile — and only once they exist.
  const tiles = counts
    ? [
        { key: 'total', icon: Users, value: counts.total, label: 'Accounts' },
        counts.inactive > 0 && { key: 'inactive', icon: UserX, value: counts.inactive, label: 'Inactive', variant: 'negative' },
        counts.pending_first_login > 0 && {
          key: 'pending',
          icon: Clock,
          value: counts.pending_first_login,
          label: 'Pending first login',
          variant: 'warning',
        },
      ].filter(Boolean)
    : []

  return (
    <div>
      {tiles.length > 0 && (
        <StatRow>
          {tiles.map((t) => (
            <StatCard key={t.key} icon={t.icon} value={t.value} label={t.label} variant={t.variant} />
          ))}
        </StatRow>
      )}

      <TableToolbar
        search={search}
        onSearchChange={(v) => {
          setPage(1)
          setSearch(v)
        }}
        searchPlaceholder="Search by name or email"
        isFiltered={filtersActive}
        onClearFilters={clearFilters}
        filters={
          <>
            <TableFilter label="Role">
              <select
                value={role}
                onChange={(e) => {
                  setPage(1)
                  setRole(e.target.value)
                }}
              >
                <option value="">All roles</option>
                {Object.entries(ROLE_DISPLAY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </TableFilter>
            <TableFilter label="Status">
              <select
                value={status}
                onChange={(e) => {
                  setPage(1)
                  setStatus(e.target.value)
                }}
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </TableFilter>
            <TableFilter label="Section">
              <select
                value={sectionId}
                onChange={(e) => {
                  setPage(1)
                  setSectionId(e.target.value)
                }}
              >
                <option value="">All sections</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    Grade {s.grade_level} - {s.name}
                  </option>
                ))}
              </select>
            </TableFilter>
          </>
        }
        actions={
          <Link to="/users/new" className="btn-primary">
            <Plus size={16} strokeWidth={1.75} />
            New Account
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}

      {/* The Alert component rather than a bare .alert div: .alert is a flex
          row, so loose block children lay out side by side. This is a
          temporary password someone has to read and copy — it needs to sit
          under its heading, not beside it. */}
      {resetResult && (
        <Alert variant="success" title={`Password reset for ${resetResult.email}.`}>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
            Share this temporary password with them now — it will not be shown again. They'll be
            required to change it on next login.
          </p>
          <code className="alert__code">{resetResult.tempPassword}</code>
        </Alert>
      )}

      {editingId && (
        <form onSubmit={handleSaveEdit} className="intervention-log-form">
          <h3>Edit Account</h3>
          <div className="intervention-log-form__fields">
            <label>Full Name</label>
            <input
              value={editForm.fullName}
              onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
              required
            />

            <label>Email</label>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              required
            />

            <label>Role</label>
            {editForm.role === 'admin' ? (
              <input value="Admin" disabled title="Admin accounts cannot be reassigned through this form." />
            ) : (
              <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Section/class assignments are managed from Academic Setup (
            <Link to="/academic-setup/sections">Sections</Link>, <Link to="/academic-setup/class-offerings">Class Offerings</Link>) —
            reassigning a role here is blocked while the account still holds one.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <DataTable
          columns={[
            { key: 'name', header: 'Name', render: (a) => a.full_name },
            { key: 'email', header: 'Email', render: (a) => fieldValue(a.email) },
            { key: 'role', header: 'Role', render: (a) => ROLE_DISPLAY_LABELS[a.role] || a.role },
            {
              key: 'assignment',
              header: 'Section / Classes',
              truncate: true,
              render: (a) => fieldValue(a.assignment_summary),
            },
            {
              key: 'status',
              header: 'Status',
              uniformValue: (a) => `${a.is_active}|${a.must_change_password}`,
              render: (a) => <AccountStatusCell account={a} />,
            },
          ]}
          rows={accounts}
          rowKey={(a) => a.id}
          rowActions={(a) => [
            { key: 'edit', label: 'Edit account', icon: Pencil, onSelect: () => startEdit(a) },
            {
              key: 'toggle',
              label: a.is_active ? 'Deactivate' : 'Reactivate',
              icon: Power,
              danger: a.is_active,
              disabled: a.id === currentUser?.id && a.is_active,
              title: a.id === currentUser?.id && a.is_active ? 'You cannot deactivate your own account.' : undefined,
              onSelect: () => handleToggleActive(a),
            },
            {
              key: 'reset',
              label: resettingId === a.id ? 'Resetting…' : 'Reset password',
              icon: KeyRound,
              disabled: resettingId === a.id,
              onSelect: () => handleReset(a),
            },
          ]}
          isFiltered={filtersActive}
          error={error}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          emptyState={<p>No accounts yet.</p>}
          noResultsState={
            <>
              <p>No accounts match your filters.</p>
              <p>
                <button type="button" className="link-button" onClick={clearFilters}>
                  Clear filters
                </button>{' '}
                to see every account.
              </p>
            </>
          }
        />
      )}
    </div>
  )
}

// Tab 2: Student Records with no portal login yet (students.user_id IS
// NULL) — the bulk-creation surface. Reuses the same per-student creation
// logic as the single "New Student Account" form (services/accountCreation.js
// on the backend) rather than a parallel implementation, so eligibility
// rules (has email, not already provisioned) can never drift between the
// two paths.
function PendingStudentAccountsTab() {
  const [students, setStudents] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState(null) // { created, failures } | null

  function load() {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE, hasAccount: 'false' })
    if (search) params.set('search', search)

    api
      .get(`/students?${params.toString()}`)
      .then((data) => {
        setStudents(data.students)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [page, search])

  function toggle(studentId) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  function toggleAllEligible() {
    const eligibleIds = (students || []).filter((s) => s.email).map((s) => s.id)
    const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id))
    setSelected(allSelected ? new Set() : new Set(eligibleIds))
  }

  async function handleCreateSelected() {
    setError(null)
    setCreating(true)
    try {
      const data = await api.post('/users/bulk-create-student-accounts', { studentIds: Array.from(selected) })
      setResult(data)
      setSelected(new Set())
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const eligibleSelectedCount = Array.from(selected).length

  return (
    <div>
      <div className="page-header__actions" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="search-field">
          <Search size={16} strokeWidth={1.75} />
          <input
            type="search"
            placeholder="Search by name or LRN"
            value={search}
            onChange={(e) => {
              setPage(1)
              setSearch(e.target.value)
            }}
          />
        </div>
        <button type="button" className="btn-primary" disabled={eligibleSelectedCount === 0 || creating} onClick={handleCreateSelected}>
          <UserPlus size={16} strokeWidth={1.75} />
          {creating ? 'Creating…' : `Create ${eligibleSelectedCount || ''} Account${eligibleSelectedCount === 1 ? '' : 's'}`}
        </button>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* The Alert component rather than a bare .alert div: .alert is a flex
          row, so loose block children lay out side by side. This is a
          temporary password someone has to read and copy — it needs to sit
          under its heading, not beside it. */}
      {result && (
        <Alert
          variant="success"
          className="alert--block"
          title={`Created ${result.created.length} account${result.created.length === 1 ? '' : 's'}${
            result.failures.length > 0 ? `, ${result.failures.length} failed` : ''
          }.`}
        >
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
            Share each temporary password with that student now — they will not be shown again. Every
            student will be required to change their password on first login.
          </p>
          {result.created.length > 0 && (
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
                  {result.created.map((c) => (
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
          {result.failures.length > 0 && (
            <div className="table-card" style={{ marginTop: 'var(--space-3)' }}>
              <table>
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.failures.map((f) => (
                    <tr key={f.studentId}>
                      <td>{f.studentId}</td>
                      <td>{f.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Alert>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : students.length === 0 ? (
        <div className="empty-state">
          <p>Every active student already has a portal account.</p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={students.some((s) => s.email) && students.filter((s) => s.email).every((s) => selected.has(s.id))}
                    onChange={toggleAllEligible}
                  />
                </th>
                <th>Student</th>
                <th>LRN</th>
                <th>Section</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={selected.has(s.id)}
                      disabled={!s.email}
                      onChange={() => toggle(s.id)}
                    />
                  </td>
                  <td>
                    {s.last_name}, {s.first_name}
                  </td>
                  <td>{s.lrn}</td>
                  <td>{s.section_name ? `Grade ${s.grade_level} – ${s.section_name}` : '—'}</td>
                  <td>
                    {s.email || (
                      <span className="form-note form-note--danger">No email on file</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}

// Admin/registrar User Management — full account roster (staff AND
// students), covering list/search/filter, edit, activate/deactivate, and
// bulk student account creation. Role/section-assignment reassignment for
// advisers and subject teachers is intentionally NOT duplicated here — it's
// already a full admin CRUD surface under Academic Setup (Sections, Class
// Offerings); this page links to those rather than re-implementing them.
export function UserManagementPage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'User Management' }]} />
      <div className="page-header">
        <h1>User Management</h1>
      </div>

      <Tabs
        tabs={[
          { key: 'accounts', label: 'All Accounts', content: <AllAccountsTab /> },
          { key: 'pending', label: 'Pending Student Accounts', content: <PendingStudentAccountsTab /> },
        ]}
      />
    </div>
  )
}
