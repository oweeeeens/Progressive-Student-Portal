import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, CircleDot, Eye, CheckCircle2, ArrowUpCircle } from 'lucide-react'
import { api } from '../api/client'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import {
  InterventionDetailPanel,
  INTERVENTION_TYPE_LABELS,
  INTERVENTION_STATUS_VARIANTS,
  RISK_VARIANTS,
} from '../components/InterventionDetailPanel'

const PAGE_SIZE = 15

// Cross-student view of every intervention this user can see — same
// adviser/own-section scoping the backend already applies everywhere else.
// Clicking a row expands the exact same detail/edit panel used inline on
// the Student Detail page, so status changes go through one code path.
export function InterventionsPage() {
  const [interventions, setInterventions] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [interventionType, setInterventionType] = useState('')
  const [error, setError] = useState(null)
  const [counts, setCounts] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    api
      .get('/interventions/stats')
      .then((data) => setCounts(data.counts))
      .catch((err) => setError(err.message))
  }, [])

  function load() {
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (interventionType) params.set('interventionType', interventionType)

    api
      .get(`/interventions?${params.toString()}`)
      .then((data) => {
        setInterventions(data.interventions)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    setExpandedId(null)
    load()
  }, [page, search, status, interventionType])

  async function handleStatusChange(id, newStatus) {
    try {
      await api.patch(`/interventions/${id}/status`, { status: newStatus })
      load()
      api.get('/interventions/stats').then((data) => setCounts(data.counts))
    } catch (err) {
      setError(err.message)
    }
  }

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id))
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Interventions' }]} />

      <div className="page-header">
        <h1>Interventions</h1>
        <div className="page-header__actions">
          <div className="search-field">
            <Search size={16} strokeWidth={1.75} />
            <input
              type="search"
              placeholder="Search by student name"
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
              {Object.keys(INTERVENTION_STATUS_VARIANTS).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={interventionType}
              onChange={(e) => {
                setPage(1)
                setInterventionType(e.target.value)
              }}
            >
              <option value="">All</option>
              {Object.entries(INTERVENTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {counts && (
        <StatRow>
          <StatCard icon={CircleDot} value={counts.open} label="Open" />
          <StatCard icon={Eye} value={counts.monitoring} label="Monitoring" variant="info" />
          <StatCard icon={CheckCircle2} value={counts.resolved} label="Resolved" variant="positive" />
          <StatCard icon={ArrowUpCircle} value={counts.escalated} label="Escalated" variant="negative" />
        </StatRow>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!interventions ? (
        <p>Loading interventions…</p>
      ) : interventions.length === 0 ? (
        <div className="empty-state">
          {search || status || interventionType ? (
            <>
              <p>No interventions match these filters.</p>
              <p>Try a different search term or clear the filters.</p>
            </>
          ) : (
            <>
              <p>No interventions logged yet.</p>
              <p>Log one from a student's detail page when they need follow-up.</p>
            </>
          )}
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Risk at logging</th>
                <th>Type</th>
                <th>Status</th>
                <th>Date logged</th>
                <th>Logged by</th>
              </tr>
            </thead>
            <tbody>
              {interventions.map((i) => {
                const studentName = `${i.student_last_name}, ${i.student_first_name}`
                return (
                  <Fragment key={i.id}>
                    <tr
                      className="is-clickable-row"
                      tabIndex={0}
                      role="button"
                      aria-expanded={expandedId === i.id}
                      onClick={() => toggleExpanded(i.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleExpanded(i.id)
                        }
                      }}
                    >
                      <td>
                        <Link to={`/students/${i.student_id}`} onClick={(e) => e.stopPropagation()}>
                          {studentName}
                        </Link>
                      </td>
                      <td>
                        <StatusPill label={i.risk_level_at_intervention} variant={RISK_VARIANTS[i.risk_level_at_intervention]} />
                      </td>
                      <td>{INTERVENTION_TYPE_LABELS[i.intervention_type]}</td>
                      <td>
                        <StatusPill label={i.status} variant={INTERVENTION_STATUS_VARIANTS[i.status]} />
                      </td>
                      <td>{i.date_logged}</td>
                      <td>{i.logged_by_name}</td>
                    </tr>
                    {expandedId === i.id && (
                      <tr className="detail-row">
                        <td colSpan={6}>
                          <InterventionDetailPanel intervention={i} studentName={studentName} onStatusChange={handleStatusChange} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
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
