import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Users, AlertTriangle, Clock, UserX, FileUp, Eye, Pencil } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { TableToolbar, TableFilter } from '../components/table/TableToolbar'
import { Alert } from '../components/Alert'

const PAGE_SIZE = 25
const canWrite = (role) => role === 'admin' || role === 'registrar'

const STATUS_VARIANTS = {
  enrolled: 'positive',
  pending: 'warning',
  dropped: 'negative',
  transferred: 'neutral',
  graduated: 'info',
}
const RISK_LABELS = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }

// What each figure above the roster counts.
//
// The one that genuinely confuses people is "Flagged on this page", and it is
// called that for a reason: unlike the others it is counted from the rows
// currently rendered, not from the whole roster. Paging or filtering changes
// it. Naming it honestly in the label is half the fix; saying so outright
// here is the other half.
function studentStatDetails(counts, students, flagged) {
  return {
    total: {
      title: 'Students',
      subtitle: counts.total,
      definition: 'Every learner you can see whose record is still active, across all pages — not just the ones shown below.',
      breakdown: [
        { label: 'Enrolled', value: counts.enrolled },
        { label: 'Pending enrollment', value: counts.pending },
        { label: 'Dropped', value: counts.dropped },
        { label: 'Transferred', value: counts.transferred },
        { label: 'Graduated', value: counts.graduated },
        { label: 'Total active records', value: counts.total, isTotal: true },
      ],
      rules: [
        'Scoped to what you are assigned to — an adviser sees their advisory section plus any section they teach a class in; admin, registrar, principal and guidance counselors see the school.',
        'Deactivated records are excluded entirely and appear in none of the figures above.',
        'Enrollment happens on paper. A record exists here because the registrar added it after the learner enrolled, which is why “enrolled” is the default rather than “pending”.',
      ],
    },
    flagged: {
      title: 'Flagged on this page',
      subtitle: flagged,
      definition:
        'Learners among the rows currently shown who have a risk level recorded for the current grading period.',
      rules: [
        'Counted from THIS PAGE of results only — it moves when you turn the page, search, or change a filter. That is why it is labelled “on this page” rather than simply “flagged”.',
        `Right now that is ${flagged} of the ${students.length} rows shown.`,
        'Any risk level counts here, including Low — so this is a wider net than the Dashboard’s at-risk card, which counts only Medium and High.',
      ],
      action: { to: '/academic-progress', label: 'See the full picture in Academic Progress' },
    },
    pending: {
      title: 'Pending enrollment',
      subtitle: counts.pending,
      definition: 'Active records whose enrollment status is still “pending” rather than “enrolled”.',
      rules: [
        'Since enrollment moved to paper, new records default to “enrolled” — so a pending record is usually one deliberately set that way, or one carried over from before that change.',
        'Pending learners still count in the total above, and still appear in the roster.',
      ],
    },
    dropped: {
      title: 'Dropped',
      subtitle: counts.dropped,
      definition: 'Active records whose enrollment status is “dropped”.',
      rules: [
        'The record is kept rather than deleted — grades, attendance and interventions already recorded against it stay intact and still belong to that learner.',
        'Still counted in the total above, because the record is active even though the learner is not enrolled.',
      ],
    },
  }
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
  // Reporting filters. Which of these the viewer may use is decided by the
  // server (a role that can't read a field can't filter by it either, or
  // the filter would leak the value by inference) — the UI simply asks what
  // it's allowed to offer rather than hardcoding the role list twice.
  const [learnerStatusFilters, setLearnerStatusFilters] = useState({})
  const [availableStatusFilters, setAvailableStatusFilters] = useState([])
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

  // The server is the authority on which learner-status fields this role may
  // see — and therefore filter by.
  useEffect(() => {
    api
      .get('/students/learner-status-fields')
      .then((data) => setAvailableStatusFilters(data.fields))
      .catch(() => setAvailableStatusFilters([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE, sortBy, sortDir })
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (sectionId) params.set('sectionId', sectionId)
    for (const [key, on] of Object.entries(learnerStatusFilters)) {
      if (on) params.set(key, 'true')
    }

    api
      .get(`/students?${params.toString()}`)
      .then((data) => {
        setStudents(data.students)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [page, search, status, sectionId, sortBy, sortDir, learnerStatusFilters])

  function toggleSort(column) {
    setPage(1)
    if (sortBy === column) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(column)
      setSortDir('asc')
    }
  }

  function clearFilters() {
    setPage(1)
    setSearch('')
    setStatus('')
    setSectionId('')
    setLearnerStatusFilters({})
  }

  const filtersActive = Boolean(search || status || sectionId || Object.values(learnerStatusFilters).some(Boolean))
  const anyFlagged = useMemo(() => students.some((s) => s.risk_level), [students])

  // Only tiles carrying distinct, non-obvious information. "Active
  // students" and "Enrolled" were the same number on a roster where
  // everyone is enrolled, and two more tiles read zero — four tiles saying
  // almost nothing. Total always earns its place; the exception states only
  // appear once they actually exist, and "Flagged" is the one number here a
  // reader can't get from the table at a glance.
  // Lifted out of the tiles memo below so the explanation panel reads the
  // SAME number the card shows, rather than counting the rows a second time
  // and risking a quiet disagreement between a figure and its own footnote.
  const flagged = useMemo(() => students.filter((s) => s.risk_level).length, [students])

  const { openFor, close: closeStat, cardProps } = useStatExplainer('student-stat-detail')

  const tiles = useMemo(() => {
    if (!counts) return []
    const shown = [{ key: 'total', icon: Users, value: counts.total, label: 'Students' }]
    if (flagged > 0) {
      shown.push({
        key: 'flagged',
        icon: AlertTriangle,
        value: flagged,
        label: 'Flagged on this page',
        variant: 'negative',
      })
    }
    if (counts.pending > 0) {
      shown.push({ key: 'pending', icon: Clock, value: counts.pending, label: 'Pending enrollment', variant: 'warning' })
    }
    if (counts.dropped > 0) {
      shown.push({ key: 'dropped', icon: UserX, value: counts.dropped, label: 'Dropped', variant: 'negative' })
    }
    return shown
  }, [counts, flagged])

  // Identifying column first, supporting detail next, status after that —
  // never lead with an ID number, so LRN sits behind the name.
  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      // The row IS the learner. Everything beside it is reference.
      primary: true,
      plainText: (s) => `${s.last_name}, ${s.first_name}`,
      render: (s) => (
        <span className="cell-with-mark">
          {s.risk_level && <span className={`risk-dot risk-dot--${s.risk_level}`} title={RISK_LABELS[s.risk_level]} />}
          {s.last_name}, {s.first_name}
        </span>
      ),
    },
    { key: 'lrn', header: 'LRN', render: (s) => fieldValue(s.lrn) },
    {
      key: 'section',
      header: 'Grade / Section',
      render: (s) => fieldValue(s.section_name ? `Grade ${s.grade_level} – ${s.section_name}` : null),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      // Muted when every row says the same thing — see DataTable's
      // uniformValue note.
      uniformValue: (s) => `${s.enrollment_status}|${s.is_active}`,
      // Nearly every learner on a roster is enrolled and active, so that
      // pill was a full-strength column telling the adviser what they
      // already knew. Quiet here means a dropped or inactive learner is the
      // thing the eye catches.
      quietValue: 'enrolled|true',
      render: (s) => (
        <>
          <StatusPill label={s.enrollment_status} variant={STATUS_VARIANTS[s.enrollment_status]} />
          {!s.is_active && <StatusPill label="inactive" variant="neutral" />}
        </>
      ),
    },
  ]

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Students' }]} />

      <div className="page-header">
        <h1>Students</h1>
      </div>

      {counts && tiles.length > 0 && (
        <>
          <StatRow>
            {tiles.map((t) => (
              <StatCard
                key={t.key}
                icon={t.icon}
                value={t.value}
                label={t.label}
                variant={t.variant}
                {...cardProps(t.key)}
              />
            ))}
          </StatRow>

          <StatDetail
            id="student-stat-detail"
            detail={studentStatDetails(counts, students, flagged)[openFor()]}
            onClose={closeStat}
          />
        </>
      )}

      {error && <Alert>{error}</Alert>}

      <TableToolbar
        search={search}
        onSearchChange={(v) => {
          setPage(1)
          setSearch(v)
        }}
        searchPlaceholder="Search by name or LRN"
        isFiltered={filtersActive}
        onClearFilters={clearFilters}
        filters={
          <>
            <TableFilter label="Status">
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
            </TableFilter>
            {/* Reporting filters: "pull every PWD learner" for a DepEd
                return. Only ever filters FOR the flag — the school's use
                case is producing a list, not excluding those learners. */}
            {availableStatusFilters.map((field) => (
              <label key={field.param} className="table-toolbar__filter">
                <input
                  type="checkbox"
                  checked={learnerStatusFilters[field.param] === true}
                  onChange={(e) => {
                    setPage(1)
                    setLearnerStatusFilters((f) => ({ ...f, [field.param]: e.target.checked }))
                  }}
                />
                <span>{field.shortLabel}</span>
              </label>
            ))}
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
          canWrite(user?.role) && (
            <>
              <button type="button" onClick={() => navigate('/students/bulk-import')}>
                <FileUp size={16} strokeWidth={1.75} />
                Bulk Import
              </button>
              <Link to="/students/new" className="btn-primary">
                <Plus size={16} strokeWidth={1.75} />
                New Student
              </Link>
            </>
          )
        }
      />

      <DataTable
        loading={loading}
        columns={columns}
        rows={students}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/students/${s.id}`)}
        rowActions={(s) => [
          { key: 'view', label: 'View profile', icon: Eye, onSelect: () => navigate(`/students/${s.id}`) },
          canWrite(user?.role) && {
            key: 'edit',
            label: 'Edit details',
            icon: Pencil,
            onSelect: () => navigate(`/students/${s.id}/edit`),
          },
        ]}
        sort={{ by: sortBy, dir: sortDir }}
        onSortChange={toggleSort}
        // The dot beside a name now says what it means, right above the
        // table. It takes three different colours, so the legend names
        // all three rather than implying one — an unexplained coloured
        // mark next to a person is never acceptable. Each dot also keeps
        // its title tooltip, and colour is never the only signal (the
        // student's own page states the band in words).
        legend={
          anyFlagged && (
            <>
              <span className="data-table__legend-item">Flagged at risk this grading period:</span>
              {['low', 'medium', 'high'].map((level) => (
                <span key={level} className="data-table__legend-item">
                  <span className={`risk-dot risk-dot--${level}`} />
                  {RISK_LABELS[level]}
                </span>
              ))}
            </>
          )
        }
        isFiltered={filtersActive}
        error={error}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyState={
          canWrite(user?.role) ? (
            <>
              <p>No students yet.</p>
              <p>
                <Link to="/students/new">Add the first student</Link> to get started.
              </p>
            </>
          ) : (
            <p>No students in your roster yet.</p>
          )
        }
        noResultsState={
          <>
            <p>No students match your filters.</p>
            <p>
              <button type="button" className="link-button" onClick={clearFilters}>
                Clear filters
              </button>{' '}
              to see the full roster.
            </p>
          </>
        }
    />
    </div>
  )
}
