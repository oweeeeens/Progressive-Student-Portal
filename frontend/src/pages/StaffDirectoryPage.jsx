import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatusPill } from '../components/StatusPill'
import { DataTable } from '../components/table/DataTable'
import { TableToolbar } from '../components/table/TableToolbar'
import { roleLabel } from '../utils/roleLabel'
import './StaffDirectoryPage.css'

// Staff Directory (2026-11-26) — the school's people and what each of them
// advises and teaches this school year, for every signed-in user. GET
// /api/staff-directory (staffDirectoryController).
//
// A learner sees it too, so they know who their adviser and teachers are —
// those rows are marked and listed first. A learner never receives staff
// emails: the server leaves them out, so this page simply has no Email
// column for them.

const PAGE_SIZE = 15
const POSITIONS = ['principal', 'registrar', 'guidance_counselor', 'adviser', 'subject_teacher']

const sectionLabel = (s) => `Grade ${s.gradeLevel} – ${s.name}`
const advisesText = (r) => r.advises.map(sectionLabel).join(', ')
// One line per subject, its sections together: "General Mathematics: ABM A,
// STEM A, STEM B" — much shorter than repeating the subject per section.
function teachesBySubject(r) {
  const bySubject = new Map()
  for (const c of r.teaches) {
    if (!bySubject.has(c.subject)) bySubject.set(c.subject, [])
    bySubject.get(c.subject).push(c.section)
  }
  return [...bySubject].map(([subject, sections]) => `${subject}: ${sections.join(', ')}`)
}
const teachesText = (r) => teachesBySubject(r).join('; ')

export function StaffDirectoryPage() {
  const { user } = useAuth()
  const isStudent = user?.role === 'student'
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    api
      .get('/staff-directory')
      .then(setData)
      .catch((err) => setError(`Couldn't load the staff directory: ${err.message}`))
  }, [])

  // Search and position filter, on the list the server already sent. A
  // learner's own adviser and teachers come first.
  const rows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    const filtered = data.staff.filter(
      (r) =>
        (!position || r.role === position) &&
        (!q || [r.fullName, roleLabel(r.role), advisesText(r), teachesText(r)].join(' ').toLowerCase().includes(q))
    )
    if (!isStudent) return filtered
    const mine = (r) => (r.isYourAdviser ? 0 : r.isYourTeacher ? 1 : 2)
    return [...filtered].sort((a, b) => mine(a) - mine(b))
  }, [data, search, position, isStudent])

  const columns = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      plainText: (r) => r.fullName,
      render: (r) => (
        <span className="staff-name">
          <span className="cell-primary">{r.fullName}</span>
          {r.isYourAdviser && <StatusPill label="Your adviser" variant="info" />}
          {r.isYourTeacher && !r.isYourAdviser && <StatusPill label="Your teacher" variant="info" />}
        </span>
      ),
    },
    { key: 'role', header: 'Position', plainText: (r) => roleLabel(r.role), render: (r) => roleLabel(r.role) },
    {
      key: 'advises',
      header: 'Advises',
      plainText: (r) => advisesText(r) || '—',
      // One section per line, so "Grade 12 – STEM 12-A" never breaks in two.
      render: (r) =>
        r.advises.length ? (
          <span className="staff-teaches">
            {r.advises.map((sec) => (
              <span key={sec.sectionId}>{sectionLabel(sec)}</span>
            ))}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'teaches',
      header: 'Teaches',
      plainText: (r) => teachesText(r) || '—',
      render: (r) =>
        r.teaches.length ? (
          <span className="staff-teaches">
            {teachesBySubject(r).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    ...(data?.showsEmail
      ? [{ key: 'email', header: 'Email', plainText: (r) => r.email, render: (r) => <a href={`mailto:${r.email}`}>{r.email}</a> }]
      : []),
  ]

  const counts = data ? POSITIONS.map((p) => [p, data.staff.filter((r) => r.role === p).length]).filter(([, n]) => n > 0) : []
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Staff Directory' }]} />
      <div className="page-header">
        <h1>Staff Directory</h1>
      </div>
      <p className="help-text mb-3">
        Who is who at the school this school year: each person&apos;s position, the section they advise and the classes they teach.
        {data && ` ${counts.map(([p, n]) => `${n} ${roleLabel(p).toLowerCase()}${n === 1 ? '' : 's'}`).join(' · ')}.`}
        {isStudent && ' Your adviser and your teachers are listed first.'}
      </p>
      {error && <Alert>{error}</Alert>}

      <TableToolbar
        search={search}
        onSearchChange={(value) => {
          setPage(1)
          setSearch(value)
        }}
        searchPlaceholder="Search by name, position or subject"
        filters={
          <label className="table-toolbar__filter">
            <span>Position</span>
            <select
              value={position}
              onChange={(e) => {
                setPage(1)
                setPosition(e.target.value)
              }}
            >
              <option value="">All positions</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {roleLabel(p)}
                </option>
              ))}
            </select>
          </label>
        }
        isFiltered={Boolean(search || position)}
        onClearFilters={() => {
          setSearch('')
          setPosition('')
          setPage(1)
        }}
      />

      {/* Wrapper: this table's Advises and Teaches cells may wrap
          (StaffDirectoryPage.css) — here the assignments ARE the content,
          so clipping them behind a tooltip would hide what people came for. */}
      <div className="staff-directory">
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        loading={!data && !error}
        error={error}
        isFiltered={Boolean(search || position)}
        page={page}
        pageSize={PAGE_SIZE}
        total={rows.length}
        onPageChange={setPage}
        emptyState={<p>No staff are listed yet.</p>}
        noResultsState={<p>No one matches that search.</p>}
      />
      </div>
    </div>
  )
}
