import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Users, UserCheck, UserX, Clock, ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'

const PAGE_SIZE = 10
const canWrite = (role) => role === 'admin' || role === 'registrar'

const STATUS_VARIANTS = {
  enrolled: 'positive',
  pending: 'warning',
  dropped: 'negative',
  transferred: 'neutral',
  graduated: 'info',
}
const RISK_LABELS = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }

function SortIcon({ active, dir }) {
  if (!active) return null
  return dir === 'desc' ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronUp size={14} strokeWidth={2} />
}

export function StudentListPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [students, setStudents] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [sections, setSections] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState(null)

  // Scoped the same way the list is, so an adviser's totals describe their
  // own section rather than the whole school.
  useEffect(() => {
    api
      .get('/students/stats')
      .then((data) => setCounts(data.counts))
      .catch((err) => setError(err.message))
  }, [])

  // The filter's own options — an adviser only ever sees their own
  // section's students anyway, so offering every other section here would
  // just be a picker full of choices that always return empty.
  useEffect(() => {
    const path = user?.role === 'adviser' ? '/sections/mine' : '/sections'
    api.get(path).then((data) => setSections(data.sections))
  }, [user?.role])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE, sortBy, sortDir })
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (sectionId) params.set('sectionId', sectionId)

    api
      .get(`/students?${params.toString()}`)
      .then((data) => {
        setStudents(data.students)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [page, search, status, sectionId, sortBy, sortDir])

  function toggleSort(column) {
    setPage(1)
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDir('asc')
    }
  }

  function handleRowClick(e, studentId) {
    if (e.target.closest('a')) return // the name's own Link already navigates
    navigate(`/students/${studentId}`)
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const filtersActive = Boolean(search || status || sectionId)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Students' }]} />

      <div className="page-header">
        <h1>Students</h1>
        <div className="page-header__actions">
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
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setPage(1)
                setStatus(e.target.value)
              }}
            >
              <option value="">All</option>
              {Object.keys(STATUS_VARIANTS).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Section
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
          </label>
          {canWrite(user?.role) && (
            <Link to="/students/new" className="btn-primary">
              <Plus size={16} strokeWidth={1.75} />
              New Student
            </Link>
          )}
        </div>
      </div>

      {counts && (
        <StatRow>
          <StatCard icon={Users} value={counts.total} label="Active students" />
          <StatCard icon={UserCheck} value={counts.enrolled} label="Enrolled" variant="positive" />
          <StatCard icon={Clock} value={counts.pending} label="Pending enrollment" variant="warning" />
          <StatCard icon={UserX} value={counts.dropped} label="Dropped" variant="negative" />
        </StatRow>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {loading ? (
        <p>Loading students…</p>
      ) : students.length === 0 ? (
        <div className="empty-state">
          {filtersActive ? (
            <>
              <p>No students match these filters.</p>
              <p>Try a different search term or clear the filters.</p>
            </>
          ) : canWrite(user?.role) ? (
            <>
              <p>No students yet.</p>
              <p>
                <Link to="/students/new">Add the first student</Link> to get started.
              </p>
            </>
          ) : (
            <p>No students in your roster yet.</p>
          )}
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>LRN</th>
                <th>
                  <button type="button" className="sortable-header" onClick={() => toggleSort('name')}>
                    Name <SortIcon active={sortBy === 'name'} dir={sortDir} />
                  </button>
                </th>
                <th>Grade / Section</th>
                <th>
                  <button type="button" className="sortable-header" onClick={() => toggleSort('status')}>
                    Status <SortIcon active={sortBy === 'status'} dir={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr
                  key={s.id}
                  className="is-clickable-row"
                  tabIndex={0}
                  onClick={(e) => handleRowClick(e, s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/students/${s.id}`)
                  }}
                >
                  <td>{s.lrn}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      {s.risk_level && (
                        <span className={`risk-dot risk-dot--${s.risk_level}`} title={RISK_LABELS[s.risk_level]} />
                      )}
                      <Link to={`/students/${s.id}`}>
                        {s.last_name}, {s.first_name}
                      </Link>
                    </div>
                  </td>
                  <td>{s.section_name ? `Grade ${s.grade_level} – ${s.section_name}` : '—'}</td>
                  <td>
                    <StatusPill label={s.enrollment_status} variant={STATUS_VARIANTS[s.enrollment_status]} />
                    {!s.is_active && <StatusPill label="inactive" variant="neutral" />}
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
