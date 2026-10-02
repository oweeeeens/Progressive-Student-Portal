import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, ShieldAlert, ShieldX, TrendingUp, TrendingDown, Minus, Info, HeartHandshake, ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { INTERVENTION_TYPE_LABELS } from '../components/InterventionDetailPanel'

const LEVEL_VARIANTS = { high: 'risk-high', medium: 'risk-medium', low: 'risk-low', not_yet_calculated: 'neutral' }
const LEVEL_LABELS = { high: 'High', medium: 'Medium', low: 'Low', not_yet_calculated: 'Not yet calculated' }
const RISK_RANK = { high: 3, medium: 2, low: 1, not_yet_calculated: 0 }
const NOT_CALCULATED_EXPLANATION = 'Not enough grading periods of finalized data yet.'

function TrendIcon({ trend }) {
  if (trend == null) return null
  const value = Number(trend)
  if (value > 0) return <TrendingUp size={14} strokeWidth={2} className="trend-icon trend-icon--up" />
  if (value < 0) return <TrendingDown size={14} strokeWidth={2} className="trend-icon trend-icon--down" />
  return <Minus size={14} strokeWidth={2} className="trend-icon trend-icon--flat" />
}

function SortIcon({ active, dir }) {
  if (!active) return null
  return dir === 'desc' ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronUp size={14} strokeWidth={2} />
}

// The adviser/guidance-counselor view requested directly: each student's
// risk level and exactly which factors triggered it. The "why" comes
// straight from the API (riskDashboardController re-derives it from the
// same calculator that produced the score, so it can never disagree).
export function RiskDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sections, setSections] = useState([])
  const [periods, setPeriods] = useState([])
  const [sectionId, setSectionId] = useState('')
  const [gradingPeriodId, setGradingPeriodId] = useState('')
  const [students, setStudents] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [loggingForId, setLoggingForId] = useState(null)
  const [interventionType, setInterventionType] = useState('parent_conference')
  const [interventionNotes, setInterventionNotes] = useState('')
  const [loggingSubmitting, setLoggingSubmitting] = useState(false)
  const [loggingError, setLoggingError] = useState(null)

  useEffect(() => {
    if (user.role === 'adviser') {
      api.get('/sections/mine').then((data) => {
        setSections(data.sections)
        if (data.sections.length === 1) setSectionId(String(data.sections[0].id))
      })
    } else {
      api.get('/sections').then((data) => setSections(data.sections))
    }
    api.get('/grading-periods').then((data) => setPeriods(data.gradingPeriods))
  }, [user.role])

  function load() {
    if (user.role === 'adviser' && !sectionId) return // adviser must pick a section; the API requires it
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (sectionId) params.set('sectionId', sectionId)
    if (gradingPeriodId) params.set('gradingPeriodId', gradingPeriodId)

    api
      .get(`/risk-dashboard?${params.toString()}`)
      .then((data) => setStudents(data.students))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [sectionId, gradingPeriodId, user.role])

  // Derived client-side from the list already on screen, rather than a
  // second request — this list is already scoped/filtered exactly the way
  // the counts should be.
  const counts = useMemo(() => {
    const result = { low: 0, medium: 0, high: 0 }
    for (const s of students) {
      if (s.riskLevel === 'low' || s.riskLevel === 'medium' || s.riskLevel === 'high') {
        result[s.riskLevel] += 1
      }
    }
    return result
  }, [students])

  // The server already returns high->medium->low->null, which is the
  // sensible default — only re-sort once the user actually clicks a
  // sortable column header.
  const sortedStudents = useMemo(() => {
    if (!sortBy) return students
    const sorted = [...students].sort((a, b) => {
      const diff =
        sortBy === 'score'
          ? (a.riskScore ?? -1) - (b.riskScore ?? -1)
          : RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel]
      return sortDir === 'desc' ? -diff : diff
    })
    return sorted
  }, [students, sortBy, sortDir])

  function toggleSort(column) {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDir('asc')
    }
  }

  function handleRowClick(e, studentId) {
    if (e.target.closest('a, button')) return
    navigate(`/students/${studentId}`)
  }

  function toggleLogForm(studentId) {
    setLoggingError(null)
    setInterventionNotes('')
    setLoggingForId((current) => (current === studentId ? null : studentId))
  }

  async function handleLogIntervention(e, studentId) {
    e.preventDefault()
    setLoggingError(null)
    setLoggingSubmitting(true)
    try {
      await api.post(`/students/${studentId}/interventions`, { interventionType, notes: interventionNotes })
      setLoggingForId(null)
    } catch (err) {
      setLoggingError(err.message)
    } finally {
      setLoggingSubmitting(false)
    }
  }

  // Logging an intervention here requires a risk assessment for today's
  // actual current period (same rule interventionController enforces
  // everywhere else) — only true when viewing "Current", not an explicit
  // past period, so the action is hidden rather than offered and failing.
  const viewingCurrentPeriod = !gradingPeriodId

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Risk Dashboard' }]} />

      <div className="page-header">
        <h1>Risk Dashboard</h1>
        <div className="page-header__actions">
          <label>
            Section
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {user.role !== 'adviser' && <option value="">All sections</option>}
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Grade {s.grade_level} - {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grading Period
            <select value={gradingPeriodId} onChange={(e) => setGradingPeriodId(e.target.value)}>
              <option value="">Current</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!loading && students.length > 0 && (
        <StatRow>
          <StatCard icon={ShieldCheck} value={counts.low} label="Low risk" variant="risk-low" />
          <StatCard icon={ShieldAlert} value={counts.medium} label="Medium risk" variant="risk-medium" />
          <StatCard icon={ShieldX} value={counts.high} label="High risk" variant="risk-high" />
        </StatRow>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : students.length === 0 ? (
        <div className="empty-state">
          <p>No students to show.</p>
          <p>{user.role === 'adviser' && !sectionId ? 'Select a section above.' : 'Nothing matches the current filters.'}</p>
        </div>
      ) : (
        <div className="table-card">
          <table className="risk-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Section</th>
                <th>
                  <button type="button" className="sortable-header" onClick={() => toggleSort('risk')}>
                    Risk <SortIcon active={sortBy === 'risk'} dir={sortDir} />
                  </button>
                </th>
                <th>
                  <button type="button" className="sortable-header" onClick={() => toggleSort('score')}>
                    Score <SortIcon active={sortBy === 'score'} dir={sortDir} />
                  </button>
                </th>
                <th>Grade / Trend</th>
                <th>Attendance / Trend</th>
                <th>Triggered Factors</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((s) => {
                const canLogIntervention =
                  viewingCurrentPeriod && (s.riskLevel === 'medium' || s.riskLevel === 'high')
                const riskRowClass =
                  s.riskLevel && s.riskLevel !== 'not_yet_calculated'
                    ? ` risk-row--${s.riskLevel}`
                    : ' is-uncalculated'

                return (
                  <Fragment key={s.studentId}>
                    <tr
                      className={`is-clickable-row${riskRowClass}`}
                      tabIndex={0}
                      onClick={(e) => handleRowClick(e, s.studentId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/students/${s.studentId}`)
                      }}
                    >
                      <td>
                        <Link to={`/students/${s.studentId}`}>
                          {s.lastName}, {s.firstName}
                        </Link>
                      </td>
                      <td>{s.sectionName ? `Grade ${s.gradeLevel} - ${s.sectionName}` : '—'}</td>
                      <td>
                        <StatusPill label={LEVEL_LABELS[s.riskLevel] || s.riskLevel} variant={LEVEL_VARIANTS[s.riskLevel]} />
                        {s.riskLevel === 'not_yet_calculated' && (
                          <Info size={14} strokeWidth={1.75} className="risk-info-icon" title={NOT_CALCULATED_EXPLANATION} />
                        )}
                      </td>
                      <td>{s.riskScore ?? '—'}</td>
                      <td>
                        {s.averageGrade ?? '—'}
                        {s.gradeTrend != null && ` (${Number(s.gradeTrend) > 0 ? '+' : ''}${s.gradeTrend}/period)`}
                        <TrendIcon trend={s.gradeTrend} />
                      </td>
                      <td>
                        {s.attendanceRate != null ? `${s.attendanceRate}%` : '—'}
                        {s.attendanceTrend != null && ` (${Number(s.attendanceTrend) > 0 ? '+' : ''}${s.attendanceTrend}/period)`}
                        <TrendIcon trend={s.attendanceTrend} />
                      </td>
                      <td>
                        {s.factors.length === 0 ? (
                          '—'
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                            {s.factors.map((f) => (
                              <li key={f.key}>{f.label}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        {canLogIntervention && (
                          <button
                            type="button"
                            className="btn-subtle"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleLogForm(s.studentId)
                            }}
                          >
                            <HeartHandshake size={13} strokeWidth={1.75} /> Log Intervention
                          </button>
                        )}
                      </td>
                    </tr>
                    {loggingForId === s.studentId && (
                      <tr className="detail-row">
                        <td colSpan={8}>
                          <form
                            onSubmit={(e) => handleLogIntervention(e, s.studentId)}
                            style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}
                          >
                            <select value={interventionType} onChange={(e) => setInterventionType(e.target.value)}>
                              {Object.entries(INTERVENTION_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <input
                              placeholder="Notes"
                              value={interventionNotes}
                              onChange={(e) => setInterventionNotes(e.target.value)}
                              style={{ flex: 1, minWidth: '200px' }}
                            />
                            <button type="submit" className="btn-primary" disabled={loggingSubmitting}>
                              {loggingSubmitting ? 'Logging…' : 'Log Intervention'}
                            </button>
                            <button type="button" disabled={loggingSubmitting} onClick={() => setLoggingForId(null)}>
                              Cancel
                            </button>
                          </form>
                          {loggingError && <p style={{ color: 'var(--color-danger)', marginTop: 'var(--space-2)' }}>{loggingError}</p>}
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
    </div>
  )
}
