import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, Activity, Award, HeartHandshake, ChevronUp, ChevronRight, ExternalLink } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { TrendIcon } from '../components/TrendIcon'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { INTERVENTION_TYPE_LABELS } from '../components/InterventionDetailPanel'
import { Alert } from '../components/Alert'

const BAND_PAGE_SIZE = 15
const LEVEL_VARIANTS = { high: 'risk-high', medium: 'risk-medium', low: 'risk-low' }
const LEVEL_LABELS = { high: 'High', medium: 'Medium', low: 'Low' }
const NOT_CALCULATED_EXPLANATION = 'Not enough grading periods of finalized data yet.'

// Academic Progress Tracking (formerly "Risk Dashboard") — every student in
// scope, grouped into three performance bands so an adviser sees their
// whole class in one view, not just the students already flagged. The At
// Risk band keeps the existing Low/Medium/High risk-scoring logic and
// triggered-factor detail completely unchanged; it's just one of three
// groups now instead of the only thing shown. band/advisories/note all come
// straight from the API (academicProgressController re-derives them from
// the same stored risk_assessments numbers the engine computed, so this
// page can never disagree with how a student got classified).
export function AcademicProgressPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sections, setSections] = useState([])
  const [periods, setPeriods] = useState([])
  const [sectionId, setSectionId] = useState('')
  const [gradingPeriodId, setGradingPeriodId] = useState('')
  const [students, setStudents] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [loggingForId, setLoggingForId] = useState(null)
  const [interventionType, setInterventionType] = useState('parent_conference')
  const [interventionNotes, setInterventionNotes] = useState('')
  const [loggingSubmitting, setLoggingSubmitting] = useState(false)
  const [loggingError, setLoggingError] = useState(null)
  // Each band paginates independently — they're three separate tables, not
  // one list, so "page 2" means something different in each. Reset together
  // whenever the underlying roster changes (new section/period), below.
  const [atRiskPage, setAtRiskPage] = useState(1)
  const [averagePage, setAveragePage] = useState(1)
  const [performingWellPage, setPerformingWellPage] = useState(1)

  useEffect(() => {
    if (user.role === 'adviser') {
      api.get('/sections/mine').then((data) => {
        setSections(data.sections)
        // Default to the adviser's own section, never "All sections" (the
        // backend already 400s/403s an adviser who tries that — see
        // academicProgressController.js — this just keeps the UI from ever
        // presenting that dead end). Picks the first section even when an
        // adviser has more than one, rather than leaving the picker empty
        // and forcing a manual choice before the page shows anything.
        if (data.sections.length > 0) setSectionId(String(data.sections[0].id))
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
      .get(`/academic-progress?${params.toString()}`)
      .then((data) => {
        setStudents(data.students)
        setAtRiskPage(1)
        setAveragePage(1)
        setPerformingWellPage(1)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [sectionId, gradingPeriodId, user.role])

  // Grouped by band, At Risk first — each group internally keeps the
  // server's own ordering (high->medium->low within At Risk; last name
  // otherwise), so nothing needs re-sorting client-side.
  const { atRisk, average, performingWell, notYetCalculated } = useMemo(() => {
    const groups = { atRisk: [], average: [], performingWell: [], notYetCalculated: [] }
    for (const s of students) {
      if (s.band === 'at_risk') groups.atRisk.push(s)
      else if (s.band === 'performing_well') groups.performingWell.push(s)
      else if (s.band === 'average') groups.average.push(s)
      else groups.notYetCalculated.push(s)
    }
    return groups
  }, [students])

  const pagedAtRisk = useMemo(
    () => atRisk.slice((atRiskPage - 1) * BAND_PAGE_SIZE, atRiskPage * BAND_PAGE_SIZE),
    [atRisk, atRiskPage]
  )
  const pagedAverage = useMemo(
    () => average.slice((averagePage - 1) * BAND_PAGE_SIZE, averagePage * BAND_PAGE_SIZE),
    [average, averagePage]
  )
  const pagedPerformingWell = useMemo(
    () => performingWell.slice((performingWellPage - 1) * BAND_PAGE_SIZE, performingWellPage * BAND_PAGE_SIZE),
    [performingWell, performingWellPage]
  )

  // At Risk rows expand in place instead of navigating away — see this
  // file's header comment on the "glanceable by default, click for the full
  // breakdown" goal. Every other band navigates, and the row menu offers
  // "Open student profile" either way.
  function toggleExpandedById(studentId) {
    setExpandedId((current) => (current === studentId ? null : studentId))
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

  // Returns just the form — DataTable supplies the expanded row and cell.
  function renderInterventionForm(s) {
    return (
      <div style={{ marginTop: 'var(--space-3)' }}>
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
          {loggingError && <Alert>{loggingError}</Alert>}
      </div>
    )
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Academic Progress Tracking' }]} />

      <div className="page-header">
        <h1>Academic Progress Tracking</h1>
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
          <StatCard icon={ShieldAlert} value={atRisk.length} label="At Risk" variant="negative" />
          <StatCard icon={Activity} value={average.length} label="Average / Steady" variant="info" />
          <StatCard icon={Award} value={performingWell.length} label="Performing Well" variant="positive" />
        </StatRow>
      )}

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <p>Loading…</p>
      ) : students.length === 0 ? (
        <div className="empty-state">
          {/* With an error above, an empty list means the data could not be
              read — not that the filters excluded everyone, which is what
              this used to tell the reader either way. */}
          <p>{error ? 'This page could not be loaded.' : 'No students to show.'}</p>
          {!error && (
            <p>
              {user.role === 'adviser' && !sectionId ? 'Select a section above.' : 'Nothing matches the current filters.'}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Shared column shape across the band tables — identifying
              column first, supporting detail next, status last, so a reader
              moving between bands never has to re-learn the layout. */}
          <h2 style={{ marginTop: 'var(--space-5)' }}>At Risk ({atRisk.length})</h2>
          <DataTable
            columns={[
              { key: 'student', header: 'Student', render: (s) => `${s.lastName}, ${s.firstName}` },
              {
                key: 'section',
                header: 'Section',
                render: (s) => fieldValue(s.sectionName ? `Grade ${s.gradeLevel} - ${s.sectionName}` : null),
              },
              {
                key: 'concern',
                header: 'Top Concern',
                truncate: true,
                render: (s) =>
                  s.topConcern ? (
                    <>
                      {s.topConcern.factorLabel}
                      {s.advisories.length > 1 && (
                        <span style={{ color: 'var(--color-text-muted)' }}> (+{s.advisories.length - 1} more)</span>
                      )}
                    </>
                  ) : (
                    fieldValue(null)
                  ),
              },
              {
                key: 'risk',
                header: 'Risk',
                uniformValue: (s) => s.riskLevel,
                render: (s) => <StatusPill label={LEVEL_LABELS[s.riskLevel]} variant={LEVEL_VARIANTS[s.riskLevel]} />,
              },
            ]}
            rows={pagedAtRisk}
            rowKey={(s) => s.studentId}
            onRowClick={(s) => toggleExpandedById(s.studentId)}
            rowActions={(s) => [
              {
                key: 'open',
                label: 'Open student profile',
                icon: ExternalLink,
                onSelect: () => navigate(`/students/${s.studentId}`),
              },
              {
                key: 'details',
                label: expandedId === s.studentId ? 'Hide factors' : 'View factors',
                icon: expandedId === s.studentId ? ChevronUp : ChevronRight,
                onSelect: () => toggleExpandedById(s.studentId),
              },
              viewingCurrentPeriod &&
                (s.riskLevel === 'medium' || s.riskLevel === 'high') && {
                  key: 'log',
                  label: 'Log intervention',
                  icon: HeartHandshake,
                  onSelect: () => toggleLogForm(s.studentId),
                },
            ]}
            /* A row can have TWO things open at once — its factor breakdown
               and the intervention form — so the page owns the condition,
               not the table. */
            renderExpanded={(s) => {
              const showDetail = expandedId === s.studentId
              const showForm = loggingForId === s.studentId
              if (!showDetail && !showForm) return null
              return (
                <>
                  {showDetail && (
                    <>
                      <dl className="field-grid field-grid--two-col" style={{ marginBottom: 'var(--space-4)' }}>
                        <div>
                          <dt>Risk score</dt>
                          <dd>{fieldValue(s.riskScore)}</dd>
                        </div>
                        <div>
                          <dt>Grade / Trend</dt>
                          <dd>
                            {fieldValue(s.averageGrade)}
                            {s.gradeTrend != null && ` (${Number(s.gradeTrend) > 0 ? '+' : ''}${s.gradeTrend}/period)`}
                            <TrendIcon trend={s.gradeTrend} />
                          </dd>
                        </div>
                        <div>
                          <dt>Attendance / Trend</dt>
                          <dd>
                            {fieldValue(s.attendanceRate != null ? `${s.attendanceRate}%` : null)}
                            {s.attendanceTrend != null &&
                              ` (${Number(s.attendanceTrend) > 0 ? '+' : ''}${s.attendanceTrend}/period)`}
                            <TrendIcon trend={s.attendanceTrend} />
                          </dd>
                        </div>
                      </dl>
                      <strong>Triggered factors</strong>
                      <ul style={{ marginTop: 'var(--space-2)', paddingLeft: '1.1rem' }}>
                        {s.advisories.map((a) => (
                          <li key={a.factorKey}>
                            {a.factorLabel}
                            {a.advisory && ` — ${a.advisory}`}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {showForm && renderInterventionForm(s)}
                </>
              )
            }}
            page={atRiskPage}
            pageSize={BAND_PAGE_SIZE}
            total={atRisk.length}
            onPageChange={setAtRiskPage}
            emptyState={<p>No students at risk right now.</p>}
          />

          <h2 style={{ marginTop: 'var(--space-6)' }}>Average / Steady ({average.length})</h2>
          <DataTable
            columns={[
              { key: 'student', header: 'Student', render: (s) => `${s.lastName}, ${s.firstName}` },
              {
                key: 'section',
                header: 'Section',
                render: (s) => fieldValue(s.sectionName ? `Grade ${s.gradeLevel} - ${s.sectionName}` : null),
              },
              { key: 'grade', header: 'Grade', render: (s) => fieldValue(s.averageGrade) },
              {
                key: 'attendance',
                header: 'Attendance',
                render: (s) => fieldValue(s.attendanceRate != null ? `${s.attendanceRate}%` : null),
              },
              { key: 'note', header: 'Note', truncate: true, render: (s) => fieldValue(s.note) },
            ]}
            rows={pagedAverage}
            rowKey={(s) => s.studentId}
            onRowClick={(s) => navigate(`/students/${s.studentId}`)}
            rowActions={(s) => [
              {
                key: 'open',
                label: 'Open student profile',
                icon: ExternalLink,
                onSelect: () => navigate(`/students/${s.studentId}`),
              },
            ]}
            page={averagePage}
            pageSize={BAND_PAGE_SIZE}
            total={average.length}
            onPageChange={setAveragePage}
            emptyState={<p>No students in this band right now.</p>}
          />

          <h2 style={{ marginTop: 'var(--space-6)' }}>Performing Well ({performingWell.length})</h2>
          <DataTable
            columns={[
              { key: 'student', header: 'Student', render: (s) => `${s.lastName}, ${s.firstName}` },
              {
                key: 'section',
                header: 'Section',
                render: (s) => fieldValue(s.sectionName ? `Grade ${s.gradeLevel} - ${s.sectionName}` : null),
              },
              {
                key: 'grade',
                header: 'Grade / Trend',
                render: (s) => (
                  <>
                    {fieldValue(s.averageGrade)}
                    {s.gradeTrend != null && ` (${Number(s.gradeTrend) > 0 ? '+' : ''}${s.gradeTrend}/period)`}
                    <TrendIcon trend={s.gradeTrend} />
                  </>
                ),
              },
              { key: 'note', header: 'Recognition', truncate: true, render: (s) => fieldValue(s.note) },
              {
                key: 'band',
                header: 'Standing',
                uniformValue: () => 'performing_well',
                render: () => <StatusPill label="Performing Well" variant="positive" />,
              },
            ]}
            rows={pagedPerformingWell}
            rowKey={(s) => s.studentId}
            onRowClick={(s) => navigate(`/students/${s.studentId}`)}
            rowActions={(s) => [
              {
                key: 'open',
                label: 'Open student profile',
                icon: ExternalLink,
                onSelect: () => navigate(`/students/${s.studentId}`),
              },
            ]}
            page={performingWellPage}
            pageSize={BAND_PAGE_SIZE}
            total={performingWell.length}
            onPageChange={setPerformingWellPage}
            emptyState={<p>No students in this band right now.</p>}
          />

          {notYetCalculated.length > 0 && (
            /* Closed by default — this is a caveat ("nothing to show yet"),
               not actionable information, so it shouldn't compete for space
               with the three real bands above it. */
            <details style={{ marginTop: 'var(--space-6)' }}>
              <summary style={{ cursor: 'pointer' }}>
                <h2 style={{ display: 'inline' }}>Not Yet Calculated ({notYetCalculated.length})</h2>
              </summary>
              <p style={{ color: 'var(--color-text-muted)' }}>{NOT_CALCULATED_EXPLANATION}</p>
              <DataTable
                columns={[
                  { key: 'student', header: 'Student', render: (s) => `${s.lastName}, ${s.firstName}` },
                  {
                    key: 'section',
                    header: 'Section',
                    render: (s) => fieldValue(s.sectionName ? `Grade ${s.gradeLevel} - ${s.sectionName}` : null),
                  },
                ]}
                rows={notYetCalculated}
                rowKey={(s) => s.studentId}
                onRowClick={(s) => navigate(`/students/${s.studentId}`)}
                rowActions={(s) => [
                  {
                    key: 'open',
                    label: 'Open student profile',
                    icon: ExternalLink,
                    onSelect: () => navigate(`/students/${s.studentId}`),
                  },
                ]}
                emptyState={<p>Nothing pending.</p>}
              />
            </details>
          )}
        </>
      )}
    </div>
  )
}
