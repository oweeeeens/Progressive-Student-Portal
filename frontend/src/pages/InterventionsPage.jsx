import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleDot, Eye, CheckCircle2, ArrowUpCircle, ExternalLink } from 'lucide-react'
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
import { DataTable, fieldValue } from '../components/table/DataTable'
import { TableToolbar, TableFilter } from '../components/table/TableToolbar'
import { Alert } from '../components/Alert'

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
      .catch((err) => {
        setError(err.message)
        // Resolve the list to empty rather than leaving it null: null means
        // "still loading", and a request that has already failed is not
        // still loading. Without this the page showed a permanent
        // "Loading interventions…" directly under its own error message.
        setInterventions([])
        setTotal(0)
      })
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

  const navigate = useNavigate()
  const filtersActive = Boolean(search || status || interventionType)

  function clearFilters() {
    setPage(1)
    setSearch('')
    setStatus('')
    setInterventionType('')
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Interventions' }]} />

      <div className="page-header">
        <h1>Interventions</h1>
      </div>

      {/* Every status here is a distinct stage of the closed loop, so each
          earns a tile — but only once it has something in it. A row of
          zeroes tells a reader nothing they can act on. */}
      {counts && (
        <StatRow>
          {[
            { key: 'open', icon: CircleDot, value: counts.open, label: 'Open' },
            { key: 'monitoring', icon: Eye, value: counts.monitoring, label: 'Monitoring', variant: 'info' },
            { key: 'resolved', icon: CheckCircle2, value: counts.resolved, label: 'Resolved', variant: 'positive' },
            { key: 'escalated', icon: ArrowUpCircle, value: counts.escalated, label: 'Escalated', variant: 'negative' },
          ]
            .filter((t) => t.value > 0)
            .map((t) => (
              <StatCard key={t.key} icon={t.icon} value={t.value} label={t.label} variant={t.variant} />
            ))}
        </StatRow>
      )}

      {error && <Alert>{error}</Alert>}

      <TableToolbar
        search={search}
        onSearchChange={(v) => {
          setPage(1)
          setSearch(v)
        }}
        searchPlaceholder="Search by student name"
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
                {Object.keys(INTERVENTION_STATUS_VARIANTS).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </TableFilter>
            <TableFilter label="Type">
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
            </TableFilter>
          </>
        }
      />

      {!interventions ? (
        <p>Loading interventions…</p>
      ) : (
        <DataTable
          columns={[
            { key: 'student', header: 'Student', render: (i) => `${i.student_last_name}, ${i.student_first_name}` },
            { key: 'type', header: 'Type', render: (i) => INTERVENTION_TYPE_LABELS[i.intervention_type] },
            {
              key: 'risk',
              header: 'Risk at logging',
              uniformValue: (i) => i.risk_level_at_intervention,
              render: (i) => (
                <StatusPill label={i.risk_level_at_intervention} variant={RISK_VARIANTS[i.risk_level_at_intervention]} />
              ),
            },
            { key: 'logged', header: 'Date logged', render: (i) => fieldValue(i.date_logged) },
            { key: 'by', header: 'Logged by', render: (i) => fieldValue(i.logged_by_name) },
            {
              key: 'status',
              header: 'Status',
              uniformValue: (i) => i.status,
              render: (i) => <StatusPill label={i.status} variant={INTERVENTION_STATUS_VARIANTS[i.status]} />,
            },
          ]}
          rows={interventions}
          rowKey={(i) => i.id}
          onRowClick={(i) => toggleExpanded(i.id)}
          renderExpanded={(i) =>
            expandedId === i.id ? (
              <InterventionDetailPanel
                intervention={i}
                studentName={`${i.student_last_name}, ${i.student_first_name}`}
                onStatusChange={handleStatusChange}
              />
            ) : null
          }
          rowActions={(i) => [
            {
              key: 'toggle',
              label: expandedId === i.id ? 'Hide details' : 'View details',
              icon: Eye,
              onSelect: () => toggleExpanded(i.id),
            },
            {
              key: 'student',
              label: 'Open student profile',
              icon: ExternalLink,
              onSelect: () => navigate(`/students/${i.student_id}`),
            },
          ]}
          isFiltered={filtersActive}
          error={error}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          emptyState={
            <>
              <p>No interventions logged yet.</p>
              <p>Log one from a student's detail page when they need follow-up.</p>
            </>
          }
          noResultsState={
            <>
              <p>No interventions match your filters.</p>
              <p>
                <button type="button" className="link-button" onClick={clearFilters}>
                  Clear filters
                </button>{' '}
                to see them all.
              </p>
            </>
          }
        />
      )}

    </div>
  )
}
