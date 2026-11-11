import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleDot, Eye, CheckCircle2, ArrowUpCircle, ExternalLink } from 'lucide-react'
import { api } from '../api/client'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import {
  InterventionDetailPanel,
  INTERVENTION_TYPE_LABELS,
  INTERVENTION_STATUS_VARIANTS,
  RISK_VARIANTS,
} from '../components/InterventionDetailPanel'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { TableToolbar, TableFilter } from '../components/table/TableToolbar'
import { Alert } from '../components/Alert'
import { useWriteFeedback } from '../hooks/useWriteFeedback'

const PAGE_SIZE = 15

// Worst to best. Only used to say which DIRECTION a learner moved between
// the level recorded when an intervention was logged and their latest one —
// the same comparison riskEngine.closeOutInterventions makes server-side
// when it decides Resolved against Escalated. Three fixed values, so this is
// an ordering rather than a second copy of the risk rules.
const RISK_ORDER = ['low', 'medium', 'high']

// How long an intervention may sit before the dashboard starts asking about
// it. Mirrors STALE_INTERVENTION_DAYS in backend/config/dashboardQueue.js —
// the home page counts them, so this page has to agree about which ones it
// is counting.
const STALE_AFTER_DAYS = 14

// Still waiting on somebody, as opposed to finished. Resolved and escalated
// are outcomes; an age means nothing for them.
const OPEN_STATUSES = ['open', 'monitoring']

// Whole days between the day an intervention was logged and today.
//
// `date_logged` is a plain 'YYYY-MM-DD' string (backend/config/db.js returns
// DATE columns unparsed on purpose), so T00:00:00 is appended to read it as
// LOCAL midnight. Without it the browser reads the bare string as UTC and,
// at the school's UTC+8, every age comes out a day long.
function daysSince(isoDate) {
  if (!isoDate) return null
  const then = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(then.getTime())) return null
  const now = new Date()
  const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((midnightToday - then) / 86400000))
}

// Cross-student view of every intervention this user can see — same
// adviser/own-section scoping the backend already applies everywhere else.
// Clicking a row expands the exact same detail/edit panel used inline on
// the Student Detail page, so status changes go through one code path.
// What each status means, and — more usefully — what is supposed to happen
// next from it.
//
// Two of the four are set BY THE SYSTEM, not by a person, and that is the
// single most misread thing on this page: Resolved and Escalated are written
// automatically at the next risk recalculation by comparing the learner's new
// risk level against their level when the intervention was logged. Somebody
// reading "Escalated" as an accusation, or "Resolved" as a colleague's
// judgement call, has the wrong model of the page.
function interventionStatDetails(counts) {
  const total = counts.open + counts.monitoring + counts.resolved + counts.escalated

  const breakdown = [
    { label: 'Open', value: counts.open },
    { label: 'Monitoring', value: counts.monitoring },
    { label: 'Resolved', value: counts.resolved },
    { label: 'Escalated', value: counts.escalated },
    { label: 'Total logged', value: total, isTotal: true },
  ]

  return {
    open: {
      title: 'Open',
      subtitle: counts.open,
      definition: 'Support logged against a learner that nobody has started following up on yet.',
      breakdown,
      rules: [
        'The state every intervention starts in, set when an adviser or guidance counselor logs it.',
        'Move it to Monitoring yourself once follow-up is actually under way — that is a manual step, not an automatic one.',
      ],
    },
    monitoring: {
      title: 'Monitoring',
      subtitle: counts.monitoring,
      definition: 'Follow-up is under way and somebody is watching whether it works.',
      breakdown,
      rules: [
        'Set by hand when you begin acting on an Open intervention.',
        'From here the system takes over: at the next risk recalculation it compares the learner’s new risk level against their level when this was logged, and closes it as Resolved or Escalated for you.',
      ],
    },
    resolved: {
      title: 'Resolved',
      subtitle: counts.resolved,
      definition: 'The learner’s risk level improved after this support was logged.',
      breakdown,
      rules: [
        'Set AUTOMATICALLY, not by a person — the risk engine compares the new risk level against the level recorded when the intervention was logged, and marks it resolved when it has improved.',
        'This is the closed loop the whole module exists for: it is evidence the support actually helped, rather than just evidence that it happened.',
        'It does not mean the learner is no longer at risk — only that they are better off than when this was logged.',
      ],
    },
    escalated: {
      title: 'Escalated',
      subtitle: counts.escalated,
      definition: 'The learner’s risk level stayed the same or got worse after this support was logged.',
      breakdown,
      rules: [
        'Also set automatically by the same comparison — it is a statement about the outcome, not about the person who logged it.',
        'These are the ones worth reading first: something was tried and it did not move the learner, so the next step probably has to be different rather than more of the same.',
        'The Dashboard’s “open interventions” card does NOT count these, because they have already been handed on rather than waiting on you.',
      ],
    },
  }
}

export function InterventionsPage() {
  const [interventions, setInterventions] = useState(null)
  // True while ANY load is in flight, not just the first. `!interventions`
  // only covered the first load, so changing a filter left the old rows on
  // screen with nothing to say a new list was coming.
  const [loadingList, setLoadingList] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [interventionType, setInterventionType] = useState('')
  const [counts, setCounts] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  // A status change is the one write on this page, and it had neither a
  // confirmation nor an in-flight guard: the panel's buttons stayed live
  // while the request was out, so two clicks sent two writes, and a
  // successful one reported itself only by the table quietly redrawing.
  const { error, setError, busyKey, runWrite } = useWriteFeedback()
  const { openFor, close: closeStat, cardProps } = useStatExplainer('intervention-stat-detail')

  useEffect(() => {
    api
      .get('/interventions/stats')
      .then((data) => setCounts(data.counts))
      .catch((err) => setError(err.message))
  }, [setError])

  function load() {
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (interventionType) params.set('interventionType', interventionType)

    setLoadingList(true)
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
      .finally(() => setLoadingList(false))
  }

  useEffect(() => {
    setExpandedId(null)
    load()
  }, [page, search, status, interventionType, setError])

  async function handleStatusChange(id, newStatus) {
    await runWrite(
      `status-${id}`,
      async () => {
        await api.patch(`/interventions/${id}/status`, { status: newStatus })
        load()
        // The write already succeeded; a failed refresh of the counts is
        // said, not swallowed, so the tiles are not trusted while stale.
        api
          .get('/interventions/stats')
          .then((data) => setCounts(data.counts))
          .catch((err) => setError(`Saved, but the counts could not be refreshed: ${err.message}`))
      },
      // The status word with its underscore removed — these come from the
      // database as `in_progress`-style values.
      `Intervention marked ${newStatus.replace(/_/g, ' ')}.`
    )
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
        <>
          <StatRow>
            {[
              { key: 'open', icon: CircleDot, value: counts.open, label: 'Open' },
              { key: 'monitoring', icon: Eye, value: counts.monitoring, label: 'Monitoring', variant: 'info' },
              { key: 'resolved', icon: CheckCircle2, value: counts.resolved, label: 'Resolved', variant: 'positive' },
              { key: 'escalated', icon: ArrowUpCircle, value: counts.escalated, label: 'Escalated', variant: 'negative' },
            ]
              .filter((t) => t.value > 0)
              .map((t) => (
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
            id="intervention-stat-detail"
            detail={interventionStatDetails(counts)[openFor()]}
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

      <DataTable
      illustration="support"
      loading={loadingList}
      columns={[
          {
            key: 'student',
            header: 'Student',
            primary: true,
            plainText: (i) => `${i.student_last_name}, ${i.student_first_name}`,
            render: (i) => `${i.student_last_name}, ${i.student_first_name}`,
          },
          { key: 'type', header: 'Type', render: (i) => INTERVENTION_TYPE_LABELS[i.intervention_type] },
          {
            // What was actually DONE. The substance of an intervention is
            // its note, and it was reachable only by expanding a row one at
            // a time — so the one question a counselor opens this page with
            // ("what have we tried for this learner") took six clicks to
            // answer. Truncated here and complete in the expanded panel.
            key: 'notes',
            header: 'Notes',
            truncate: true,
            plainText: (i) => i.notes || '',
            render: (i) => fieldValue(i.notes),
          },
          {
            key: 'risk',
            header: 'Risk at logging',
            uniformValue: (i) => i.risk_level_at_intervention,
            render: (i) => (
              <StatusPill label={i.risk_level_at_intervention} variant={RISK_VARIANTS[i.risk_level_at_intervention]} />
            ),
          },
          {
            // THE CLOSED LOOP, on the page that is named after it.
            //
            // Until now this table showed where a learner stood when the
            // intervention was logged and never where they stand now, so
            // nothing on screen answered "did it help" — which is the whole
            // claim of CLAUDE.md Part B. The direction is stated in words
            // beside the band, never by colour alone: the two pills use the
            // same ramp, so "moved which way" cannot be left to the reader
            // comparing two shades of red.
            key: 'current_risk',
            header: 'Risk now',
            plainText: (i) => i.current_risk_level || '',
            render: (i) => {
              if (!i.current_risk_level) return fieldValue(null)
              // NOT REASSESSED YET is a different statement from NO CHANGE,
              // and saying the second when the first is true would be the
              // page's worst possible lie: it would claim an intervention
              // had been measured and found to make no difference, when in
              // fact nothing has been measured since it was logged.
              //
              // Compared on the period ID, not its name — every school year
              // has a "Term 1", so names match across years while ids do
              // not.
              const notReassessed =
                i.current_risk_period_id != null && i.current_risk_period_id === i.risk_period_id
              const from = RISK_ORDER.indexOf(i.risk_level_at_intervention)
              const to = RISK_ORDER.indexOf(i.current_risk_level)
              // Only a LIVE case gets a movement note. For a resolved or
              // escalated one the verdict is already recorded in the Status
              // column — written by riskEngine.closeOutInterventions, not
              // by this page — and re-deriving it here could contradict it.
              // It did, visibly: a seeded "Resolved" case sat beside the
              // words "not reassessed yet", which is a flat contradiction
              // for anyone reading the row.
              const movement = !OPEN_STATUSES.includes(i.status)
                ? null
                : notReassessed
                  ? 'not reassessed yet'
                  : from === -1 || to === -1
                    ? null
                    : to < from
                      ? 'improved'
                      : to > from
                        ? 'worse'
                        : 'no change'
              return (
                <span className="cell-with-mark">
                  <StatusPill label={i.current_risk_level} variant={RISK_VARIANTS[i.current_risk_level]} />
                  {movement && <span className="cell-secondary">{movement}</span>}
                </span>
              )
            },
          },
          {
            // How long this learner has been waiting. The home page counts
            // the ones past STALE_AFTER_DAYS as a task; this is where you
            // see WHICH ones, which the page could not previously tell you.
            // Blank for a finished intervention — a resolved case is not
            // "open for" anything.
            key: 'age',
            header: 'Open for',
            plainText: (i) => {
              const days = OPEN_STATUSES.includes(i.status) ? daysSince(i.date_logged) : null
              return days == null ? '' : String(days)
            },
            render: (i) => {
              if (!OPEN_STATUSES.includes(i.status)) return fieldValue(null)
              const days = daysSince(i.date_logged)
              if (days == null) return fieldValue(null)
              const text = `${days} ${days === 1 ? 'day' : 'days'}`
              // Past the threshold it stops being a duration and becomes a
              // thing to chase, so it is said in words rather than left to
              // the reader to do the subtraction against 14.
              return days >= STALE_AFTER_DAYS ? (
                <span className="cell-with-mark">
                  {text}
                  <StatusPill label="Needs follow-up" variant="warning" />
                </span>
              ) : (
                text
              )
            },
          },
          {
            key: 'logged',
            header: 'Date logged',
            uniformValue: (i) => i.date_logged,
            render: (i) => fieldValue(i.date_logged),
          },
          {
            // In a small school one counselor logs nearly all of these, so
            // this is usually the same name on every row — lifted out above
            // the table rather than repeated down it.
            key: 'by',
            header: 'Logged by',
            truncate: true,
            uniformValue: (i) => i.logged_by_name,
            plainText: (i) => i.logged_by_name,
            render: (i) => fieldValue(i.logged_by_name),
          },
          {
            key: 'status',
            header: 'Status',
            uniformValue: (i) => i.status,
            // Open is where an intervention starts and where most of them
            // sit; resolved and escalated are the outcomes worth spotting.
            quietValue: 'open',
            render: (i) => <StatusPill label={i.status} variant={INTERVENTION_STATUS_VARIANTS[i.status]} />,
          },
        ]}
        rows={interventions ?? []}
        rowKey={(i) => i.id}
        onRowClick={(i) => toggleExpanded(i.id)}
        renderExpanded={(i) =>
          expandedId === i.id ? (
            <InterventionDetailPanel
              intervention={i}
              studentName={`${i.student_last_name}, ${i.student_first_name}`}
              onStatusChange={handleStatusChange}
              busy={busyKey === `status-${i.id}`}
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
    </div>
  )
}
