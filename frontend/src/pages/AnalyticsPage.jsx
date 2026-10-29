import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  HeartHandshake,
  CalendarCheck,
  AlertTriangle,
  LayoutGrid,
  TrendingUp,
  X,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react'
import { api } from '../api/client'
import { useMediaQuery, PHONE_QUERY } from '../hooks/useMediaQuery'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'
import { SkeletonChart, SkeletonTable, LoadingAnnouncement } from '../components/Skeleton'
import { StatusPill } from '../components/StatusPill'
import { Tabs } from '../components/Tabs'
import { TrendIcon } from '../components/TrendIcon'
import { BarChart } from '../components/charts/BarChart'
import { LineChart } from '../components/charts/LineChart'
import { ColumnChart } from '../components/charts/ColumnChart'
import { ChartCard, ChartCardRow } from '../components/charts/ChartCard'
import { ChartFieldToggles } from '../components/charts/ChartFieldToggles'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { INTERVENTION_TYPE_LABELS } from '../components/InterventionDetailPanel'
import { describeTrend, describeTrendAgainstThreshold, describeLargestShare, describeGap } from '../utils/chartInterpretation'
import { Alert } from '../components/Alert'

// Fixed order, worst-to-best, used everywhere a bucket is rendered (bars,
// stacked columns, the legend, the table) — the same order the per-student
// Academic Progress Tracking page already sorts At Risk to the top by.
// Colors are deliberately all ALREADY-ESTABLISHED tokens from this app's
// own design system, not a freshly invented categorical palette: the three
// At Risk shades are the existing traffic-light risk tokens CLAUDE.md
// mandates, Average reuses the navy "info" tone already used elsewhere
// (StatusPill's info variant), and Performing Well reuses the brand gold
// accent — fitting, since that band is explicitly a recognition/reward
// state, the one place CLAUDE.md's own "gold sparingly" exception is meant
// for. Not Yet Calculated is a neutral border-gray, since it's a caveat, not
// a real band.
const BUCKET_ORDER = ['at_risk_high', 'at_risk_medium', 'at_risk_low', 'average', 'performing_well', 'not_yet_calculated']
const BUCKET_LABELS = {
  at_risk_high: 'At Risk — High',
  at_risk_medium: 'At Risk — Medium',
  at_risk_low: 'At Risk — Low',
  average: 'Average / Steady',
  performing_well: 'Performing Well',
  not_yet_calculated: 'Not Yet Calculated',
}
const BUCKET_COLORS = {
  at_risk_high: 'var(--band-at-risk-high)',
  at_risk_medium: 'var(--band-at-risk-medium)',
  at_risk_low: 'var(--band-at-risk-low)',
  average: 'var(--band-average)',
  performing_well: 'var(--band-performing-well)',
  not_yet_calculated: 'var(--risk-none)',
}
// Readable ink for a count printed INSIDE a segment of that fill — also a
// band token, so light and dark mode each get the right one automatically.
const BUCKET_LABEL_COLORS = {
  at_risk_high: 'var(--band-ink-on-at-risk-high)',
  at_risk_medium: 'var(--band-ink-on-at-risk-medium)',
  at_risk_low: 'var(--band-ink-on-at-risk-low)',
  average: 'var(--band-ink-on-average)',
  performing_well: 'var(--band-ink-on-performing-well)',
  not_yet_calculated: 'var(--color-text)',
}
const toSegment = (key) => ({
  key,
  label: BUCKET_LABELS[key],
  color: BUCKET_COLORS[key],
  labelColor: BUCKET_LABEL_COLORS[key],
})
// Every bucket, including the not-yet-assessed caveat — still needed by the
// breakdown table and the export, which report on the full roster.
const SEGMENT_SPEC = BUCKET_ORDER.map(toSegment)
// The five REAL bands. "Not Yet Calculated" is a data-coverage caveat, not a
// performance band, and when a school is mid-grading-period it can be the
// largest slice on the chart — dominating a visualization that's supposed to
// be about how students are doing. It's reported as a line of text beneath
// the chart instead (see notYetAssessedNote).
const BAND_SEGMENT_SPEC = BUCKET_ORDER.filter((key) => key !== 'not_yet_calculated').map(toSegment)
const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }
// Same priority order config/academicProgress.js's FACTOR_PRIORITY uses
// everywhere else a single ranked factor list is shown — kept as a literal
// here (not imported) since the frontend has no access to backend config;
// matches the order the /factors-trend and /top-factors responses already
// come back sorted by count in, close enough for a fixed small-multiples
// layout that isn't re-sorting on live data anyway.
const FACTOR_ORDER = ['low_grade', 'declining_grade', 'low_attendance', 'declining_attendance']
// The page-level filters, in the order they appear in the toolbar. Each one
// narrows WHICH STUDENTS every chart on every tab counts — they're passed
// straight through to the API, where a single filterRows() applies them
// identically to every endpoint (see backend/services/analyticsCalculator.js).
// `label` is what the active-filter chip says; `format` turns the stored
// value back into something readable in that chip.
const EMPTY_FILTERS = { gradingPeriodId: '', sectionId: '', gradeLevel: '', strand: '', riskBand: '' }

const RISK_BAND_OPTIONS = [
  { value: 'at_risk_any', label: 'At Risk (any level)' },
  ...BUCKET_ORDER.map((key) => ({ value: key, label: BUCKET_LABELS[key] })),
]

function formatPercent(v) {
  return v == null ? '—' : `${v}%`
}

// Only non-empty filters end up in the query string, so a page with nothing
// selected requests exactly what it always did.
function buildQuery(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const queryString = search.toString()
  return queryString ? `?${queryString}` : ''
}

// Shown in place of a chart whenever there's nothing to draw. Distinguishes
// "this school has no such data at all" from "your filters excluded all of
// it" — without that distinction a filtered-to-nothing chart looks like a
// broken page, and the way out (clear the filters) isn't obvious.
function ChartEmptyState({ message, isFiltered, onClear }) {
  return (
    <div className="empty-state">
      <p>{isFiltered ? 'No data matches the current filters.' : message}</p>
      {isFiltered && (
        <p>
          Try widening them, or{' '}
          <button type="button" className="filter-chip__clear" onClick={onClear}>
            clear all filters
          </button>.
        </p>
      )}
    </div>
  )
}

// School-wide, read-only aggregate views — Admin/Principal/Guidance
// Counselor only (route-gated server-side; see
// backend/routes/analyticsRoutes.js). Separate from the per-student
// Academic Progress Tracking page: this page never shows an individual
// student or lets the viewer take an action — every number here is a
// rollup, computed by reusing the exact same classification functions
// (riskCalculator.evaluateFactors, academicProgressCalculator.determineBand)
// the per-student views use, via services/analyticsCalculator.js, so the
// school-wide totals can never disagree with what an adviser sees on one
// student's row.
//
// Laid out as tabs (Overview/Trends/Attendance/Interventions/Factors) rather
// than one long scroll. Filter state lives HERE, in the parent, not inside
// any one tab, so switching tabs never resets it and every tab is always
// showing the same slice of the school — the dataviz skill's "filters sit in
// one row above the content they scope, and scope everything below them."
// That's also why the Attendance tab no longer has its own per-chart section
// picker: the page-level Section filter does that job now, for every chart
// at once instead of one.
export function AnalyticsPage() {
  const navigate = useNavigate()
  const [periods, setPeriods] = useState([])
  const [sections, setSections] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [groupBy, setGroupBy] = useState('')
  // Phone only: the six filter selects start collapsed behind a disclosure.
  const isPhone = useMediaQuery(PHONE_QUERY)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [distribution, setDistribution] = useState(null)
  const [trend, setTrend] = useState(null)
  const [effectiveness, setEffectiveness] = useState(null)
  const [attendance, setAttendance] = useState(null)
  const [lowestSections, setLowestSections] = useState(null)
  const [factors, setFactors] = useState(null)
  const [factorsBySection, setFactorsBySection] = useState(null)
  const [factorsTrendData, setFactorsTrendData] = useState(null)
  const [error, setError] = useState(null)
  // Two different loading states on purpose: `loading` is the very first
  // fetch, when there's genuinely nothing to show yet, and `refetching` is
  // every later one, when the charts should hold their previous render at
  // reduced opacity rather than flashing back to "Loading…".
  const [loading, setLoading] = useState(true)
  const [refetching, setRefetching] = useState(false)
  // Which export is currently generating ('pdf' | 'excel' | null) — the PDF
  // in particular takes a moment, and a button that looks idle invites a
  // second click and a second identical download.
  const [exporting, setExporting] = useState(null)

  // Which series each chart is currently drawing. Page filters change what's
  // counted; these only change what's drawn (see ChartFieldToggles).
  const [hiddenBands, setHiddenBands] = useState(() => new Set())
  const [hiddenCohorts, setHiddenCohorts] = useState(() => new Set())
  const [hiddenFactors, setHiddenFactors] = useState(() => new Set())

  useEffect(() => {
    api.get('/grading-periods').then((data) => setPeriods(data.gradingPeriods))
    api.get('/sections').then((data) => setSections(data.sections))
  }, [])

  // One effect for every chart on the page: all seven endpoints take the
  // same filters, so they're refetched together and can never end up showing
  // two different slices of the school at the same time.
  useEffect(() => {
    setRefetching(true)
    setError(null)
    const query = buildQuery(filters)
    Promise.all([
      api.get(`/analytics/risk-distribution${buildQuery({ ...filters, groupBy })}`),
      api.get(`/analytics/top-factors${query}`),
      api.get(`/analytics/lowest-attendance-sections${query}`),
      api.get(`/analytics/risk-trend${query}`),
      api.get(`/analytics/factors-trend${query}`),
      api.get(`/analytics/attendance-trend${query}`),
      api.get(`/analytics/intervention-effectiveness${query}`),
    ])
      .then(([dist, factorsData, lowest, trendData, factorsTrend, attendanceData, effectivenessData]) => {
        setDistribution(dist)
        setFactors(factorsData.factors)
        setFactorsBySection(factorsData.bySection)
        setLowestSections(lowest.sections)
        setTrend(trendData.periods)
        setFactorsTrendData(factorsTrend.periods)
        setAttendance(attendanceData)
        setEffectiveness(effectivenessData)
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false)
        setRefetching(false)
      })
  }, [filters, groupBy])

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), [])

  // Exports send the EXACT same query string the charts were fetched with,
  // so a downloaded report is a copy of what's on screen rather than a dump
  // of the whole school. The filename comes back from the server (it encodes
  // the applied filters), so none is passed here.
  async function handleExport(format) {
    setExporting(format)
    setError(null)
    try {
      await api.downloadFile(`/analytics/export/${format}${buildQuery({ ...filters, groupBy })}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(null)
    }
  }

  const toggleIn = useCallback((setter) => {
    return (key) =>
      setter((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
  }, [])

  const toggleBand = useMemo(() => toggleIn(setHiddenBands), [toggleIn])
  const toggleCohort = useMemo(() => toggleIn(setHiddenCohorts), [toggleIn])
  const toggleFactor = useMemo(() => toggleIn(setHiddenFactors), [toggleIn])

  // Grade levels and strands come from the sections that actually exist
  // rather than a hardcoded 11/12 + STEM/ABM list, so the dropdowns can
  // never offer a combination this school doesn't run.
  const gradeLevels = useMemo(
    () => [...new Set(sections.map((s) => s.grade_level).filter((g) => g != null))].sort((a, b) => a - b),
    [sections]
  )
  const strands = useMemo(
    () => [...new Set(sections.map((s) => s.strand).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [sections]
  )

  // The active-filter chips. Built from the same filters object the requests
  // use, so a chip can never claim a filter that isn't actually applied.
  const activeFilterChips = useMemo(() => {
    const chips = []
    if (filters.gradingPeriodId) {
      const match = periods.find((p) => String(p.id) === String(filters.gradingPeriodId))
      chips.push({ key: 'gradingPeriodId', label: `Period: ${match ? match.name : filters.gradingPeriodId}` })
    }
    if (filters.sectionId) {
      const match = sections.find((s) => String(s.id) === String(filters.sectionId))
      chips.push({ key: 'sectionId', label: `Section: ${match ? match.name : filters.sectionId}` })
    }
    if (filters.gradeLevel) chips.push({ key: 'gradeLevel', label: `Grade ${filters.gradeLevel}` })
    if (filters.strand) chips.push({ key: 'strand', label: `Strand: ${filters.strand}` })
    if (filters.riskBand) {
      const match = RISK_BAND_OPTIONS.find((o) => o.value === filters.riskBand)
      chips.push({ key: 'riskBand', label: `Band: ${match ? match.label : filters.riskBand}` })
    }
    return chips
  }, [filters, periods, sections])

  const isFiltered = activeFilterChips.length > 0

  // Only the five real bands feed the bar and its legend; the
  // not-yet-assessed count is reported separately below the chart.
  const distributionBars = useMemo(() => {
    if (!distribution) return []
    return BAND_SEGMENT_SPEC.map((seg) => ({
      ...seg,
      value: distribution.overall.counts[seg.key],
    }))
  }, [distribution])

  // The bar's 100% is the ASSESSED students, not the whole roster —
  // otherwise every segment silently shrinks by however many students
  // haven't been assessed yet, and the percentages stop answering "what
  // share of the students we actually know about are at risk."
  const assessedTotal = useMemo(() => {
    if (!distribution) return 0
    return distribution.overall.total - distribution.overall.counts.not_yet_calculated
  }, [distribution])

  const notYetAssessedNote = useMemo(() => {
    if (!distribution) return null
    const pending = distribution.overall.counts.not_yet_calculated
    if (pending === 0) return null
    return `${pending} of ${distribution.overall.total} students not yet assessed this period — the chart above covers the remaining ${assessedTotal}.`
  }, [distribution, assessedTotal])

  const visibleDistributionBars = useMemo(
    () => distributionBars.filter((seg) => !hiddenBands.has(seg.key)),
    [distributionBars, hiddenBands]
  )

  // One BarChart row per band. The value cell carries BOTH the count and the
  // share, so the chart needs no legend at all — each row is self-labelled,
  // and colour is never the only thing identifying a band.
  const distributionRows = useMemo(
    () =>
      visibleDistributionBars.map((seg) => ({
        key: seg.key,
        label: seg.label,
        value: seg.value,
        color: seg.color,
        valueText: `${seg.value} (${assessedTotal > 0 ? Math.round((seg.value / assessedTotal) * 1000) / 10 : 0}%)`,
        detail: `of ${assessedTotal} assessed`,
      })),
    [visibleDistributionBars, assessedTotal]
  )

  const visibleSegmentSpec = useMemo(() => BAND_SEGMENT_SPEC.filter((seg) => !hiddenBands.has(seg.key)), [hiddenBands])

  // One BarChart's worth of rows per grading period, all drawn against a
  // single shared maximum (below) so a band's bar length means the same
  // thing in every period's card.
  const periodDistributionCharts = useMemo(() => {
    if (!trend) return []
    return trend.map((p) => {
      const assessed = p.total - p.counts.not_yet_calculated
      return {
        periodName: p.periodName,
        total: assessed,
        rows: visibleSegmentSpec.map((seg) => ({
          key: seg.key,
          label: seg.label,
          value: p.counts[seg.key],
          color: seg.color,
          valueText: `${p.counts[seg.key]} (${assessed > 0 ? Math.round((p.counts[seg.key] / assessed) * 1000) / 10 : 0}%)`,
          detail: `${p.periodName} — of ${assessed} assessed`,
        })),
      }
    })
  }, [trend, visibleSegmentSpec])

  const sharedPeriodMax = useMemo(
    () => Math.max(1, ...periodDistributionCharts.flatMap((p) => p.rows.map((r) => r.value))),
    [periodDistributionCharts]
  )

  // At-risk share of the roster, per period — raw counts alone don't
  // account for the roster size changing period to period, so this is the
  // percentage, not the count, reusing the exact same totals riskTrend
  // already computed.
  const atRiskPercentPoints = useMemo(() => {
    if (!trend) return []
    return trend.map((p) => {
      const atRisk = p.counts.at_risk_high + p.counts.at_risk_medium + p.counts.at_risk_low
      return { label: p.periodName, value: p.total > 0 ? Math.round((atRisk / p.total) * 1000) / 10 : 0 }
    })
  }, [trend])

  const atRiskShiftCallout = useMemo(() => {
    if (atRiskPercentPoints.length < 2) return null
    const first = atRiskPercentPoints[atRiskPercentPoints.length - 2]
    const last = atRiskPercentPoints[atRiskPercentPoints.length - 1]
    const verb = last.value > first.value ? 'increased' : last.value < first.value ? 'decreased' : 'stayed flat at'
    return last.value === first.value
      ? `At-risk share stayed flat at ${last.value}% from ${first.label} to ${last.label}.`
      : `At-risk share ${verb} from ${first.value}% (${first.label}) to ${last.value}% (${last.label}).`
  }, [atRiskPercentPoints])

  // The section header promises a "share of assessed students," so the bars
  // plot percentage (which the backend already computes), not raw count —
  // count alone would make a small-roster school's biggest problem look like
  // the shortest bar. The raw count rides along as tooltip `detail`, so the
  // number behind the percentage is one hover away without crowding the axis.
  const factorBars = useMemo(() => {
    if (!factors) return []
    return factors
      .filter((f) => !hiddenFactors.has(f.key))
      .map((f) => ({
        key: f.key,
        label: f.label,
        value: f.percentage,
        // No colour: not a risk-band chart, so BarChart's single house blue
        // applies. Charts don't pick their own colours.
        detail: `${f.count} student${f.count === 1 ? '' : 's'}`,
      }))
  }, [factors, hiddenFactors])

  const factorToggleFields = useMemo(
    () => (factors || []).map((f) => ({ key: f.key, label: f.label, color: 'var(--chart-blue)' })),
    [factors]
  )

  // attendanceRate is null for a period with no attendance records at all
  // (common once a filter narrows to a small cohort) — passed through as
  // null, NOT coerced to 0, so the chart draws a gap rather than claiming a
  // 0% attendance rate that never happened.
  const attendancePoints = useMemo(() => {
    if (!attendance) return []
    return attendance.periods.map((p) => ({
      label: p.periodName,
      value: p.attendanceRate == null ? null : Number(p.attendanceRate),
    }))
  }, [attendance])

  // The most recent period that actually HAS a rate — with a filter applied
  // the newest period is often empty, and falling back to "—" there would
  // hide a perfectly good figure from the period before it.
  const latestAttendanceRate = useMemo(() => {
    for (let i = attendancePoints.length - 1; i >= 0; i--) {
      if (attendancePoints[i].value != null) return attendancePoints[i].value
    }
    return null
  }, [attendancePoints])

  // Two series sharing one x-axis (grading periods) — the actually-useful
  // comparison this tab exists for, per the dataviz skill's "the series
  // ARE the subject" case: the point is comparing the two cohorts' identity,
  // not just the trend of one undifferentiated average.
  const cohortFields = useMemo(
    () => [
      { key: 'at_risk', label: 'At Risk', color: 'var(--band-at-risk-high)' },
      { key: 'not_at_risk', label: 'Everyone else', color: 'var(--color-primary)' },
    ],
    []
  )

  const cohortSeries = useMemo(() => {
    if (!attendance || attendance.byRiskCohort.length === 0) return null
    const rows = attendance.byRiskCohort
    const all = [
      // Nulls stay null (see attendancePoints above): a period where this
      // cohort had no students is a gap in the line, not a 0% reading.
      {
        key: 'at_risk',
        label: 'At Risk',
        color: 'var(--band-at-risk-high)',
        points: rows.map((p) => ({ label: p.periodName, value: p.atRiskAttendanceRate })),
      },
      {
        key: 'not_at_risk',
        label: 'Everyone else',
        color: 'var(--color-primary)',
        points: rows.map((p) => ({ label: p.periodName, value: p.notAtRiskAttendanceRate })),
      },
    ]
    return all.filter((s) => !hiddenCohorts.has(s.key))
  }, [attendance, hiddenCohorts])

  // The required attendance rate the risk formula checks against, sent with
  // the attendance data rather than mirrored here (see analyticsController's
  // attendance-trend response). Nothing on this page writes the number down:
  // when the client confirms the real DepEd figure, backend/config/
  // riskConfig.js changes and every chart below follows.
  const requiredAttendance = attendance?.attendanceThreshold ?? null
  const attendanceThresholdText = requiredAttendance != null ? `${requiredAttendance}%` : '—'

  // Sections as bars rather than table rows, coloured by that same threshold,
  // so "below required" means exactly what it means everywhere else.
  const lowestSectionBars = useMemo(
    () =>
      (lowestSections || []).map((s) => ({
        key: String(s.sectionId ?? 'unassigned'),
        label: s.gradeLevel != null ? `Grade ${s.gradeLevel} - ${s.sectionName}` : s.sectionName,
        value: s.attendanceRate,
        color:
          requiredAttendance != null && s.attendanceRate < requiredAttendance ? 'var(--band-at-risk-high)' : undefined,
        detail: `${s.attendanceRate}% attendance`,
      })),
    [lowestSections, requiredAttendance]
  )

  const interventionVolumePoints = useMemo(() => {
    if (!effectiveness) return []
    return effectiveness.volumeByPeriod.map((p) => ({ label: p.periodName, value: p.count }))
  }, [effectiveness])
  const interventionVolumeMax = useMemo(
    () => Math.max(2, ...interventionVolumePoints.map((p) => p.value)) + 1,
    [interventionVolumePoints]
  )

  // Per-factor sparkline data, re-shaped from "one entry per period, each
  // listing all 4 factors" (factors-trend's natural shape, grouped the same
  // way riskTrend is) into "one point array per factor" — what
  // LineChart needs: one small-multiple line chart per factor.
  const factorSparklines = useMemo(() => {
    if (!factorsTrendData || factorsTrendData.length < 2) return []
    return FACTOR_ORDER.filter((key) => !hiddenFactors.has(key)).map((key) => {
      const points = factorsTrendData.map((period) => {
        const match = period.factors.find((f) => f.key === key)
        return { label: period.periodName, value: match ? match.percentage : 0 }
      })
      const label = factorsTrendData[0].factors.find((f) => f.key === key)?.label || key
      const last = points[points.length - 1].value
      const first = points[0].value
      return { key, label, points, latest: last, trend: last - first }
    })
  }, [factorsTrendData, hiddenFactors])

  // Wraps a populated chart so it dims (rather than disappears) during a
  // filter refetch — the frame stays, the numbers fade, nothing jumps.
  const frameClass = refetching ? 'is-refetching' : undefined

  const overviewTab = (
    <div>
      {distribution && (
        <StatRow>
          <StatCard icon={Users} value={distribution.overall.total} label="Students in view" />
          <StatCard
            icon={AlertTriangle}
            value={distribution.overall.counts.at_risk_high + distribution.overall.counts.at_risk_medium + distribution.overall.counts.at_risk_low}
            label="At Risk (all levels)"
            variant="negative"
          />
          <StatCard icon={HeartHandshake} value={effectiveness?.overall.total ?? '—'} label="Interventions logged" variant="info" />
          <StatCard
            icon={CalendarCheck}
            value={formatPercent(latestAttendanceRate)}
            label="Latest attendance rate"
            variant={latestAttendanceRate != null ? 'info' : undefined}
          />
        </StatRow>
      )}

      <div className="record-section">
        {loading || !distribution ? (
          <>
            <SkeletonChart />
            <LoadingAnnouncement />
          </>
        ) : (
          <div className={frameClass}>
            {/* One row per band — no stacked segments, so each band is read
                against the same zero instead of against whatever the band
                before it happened to be. */}
            <ChartCard
              title="Risk Distribution"
              description={notYetAssessedNote || undefined}
              /* No separate `legend` prop: the ChartFieldToggles row in
                 `actions` already carries the same swatches and labels, and
                 is interactive on top of that. Rendering both would show the
                 colour key twice on one card. */
              interpretation={describeLargestShare(distributionRows, { total: assessedTotal })}
              isEmpty={distribution.overall.total === 0 || visibleDistributionBars.length === 0}
              emptyMessage={
                distribution.overall.total === 0
                  ? 'No students match the current filters.'
                  : 'All bands are hidden — pick one below to show it again.'
              }
              actions={
                <ChartFieldToggles fields={BAND_SEGMENT_SPEC} hidden={hiddenBands} onToggle={toggleBand} label="Bands" />
              }
            >
              <BarChart rows={distributionRows} maxValue={assessedTotal} />
            </ChartCard>

            {distribution.breakdown && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <DataTable
                  columns={[
                    {
                      key: 'group',
                      header: groupBy === 'section' ? 'Section' : 'Grade Level',
                      render: (row) => row.group,
                    },
                    ...SEGMENT_SPEC.map((seg) => ({
                      key: seg.key,
                      header: seg.label,
                      align: 'right',
                      render: (row) => row.counts[seg.key],
                    })),
                    { key: 'total', header: 'Total', align: 'right', render: (row) => <strong>{row.total}</strong> },
                  ]}
                  rows={distribution.breakdown}
                  rowKey={(row) => row.group}
                  emptyState={<p>No groups to break down yet.</p>}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Something actionable, not just a count — who specifically needs a
          look, and why, one click from their full profile. */}
      {!loading && distribution?.topAtRisk?.length > 0 && (
        <div className="record-section">
          <h2>Students Needing Attention</h2>
          <div className={frameClass}>
            <DataTable
              columns={[
                { key: 'student', header: 'Student', render: (s) => `${s.lastName}, ${s.firstName}` },
                { key: 'factor', header: 'Top Factor', truncate: true, render: (s) => fieldValue(s.topFactorLabel) },
                {
                  key: 'risk',
                  header: 'Risk',
                  uniformValue: (s) => s.riskLevel,
                  render: (s) => <StatusPill label={s.riskLevel} variant={RISK_VARIANTS[s.riskLevel]} />,
                },
              ]}
              rows={distribution.topAtRisk}
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
              emptyState={<p>No students are flagged at medium or high risk right now.</p>}
            />
          </div>
        </div>
      )}
    </div>
  )

  const trendsTab = (
    <div>
      <div className="record-section">
        <h2>Risk Distribution Over Time</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
          One chart per grading period, sharing a scale — so a band's bar can be compared straight across.
        </p>
        {!trend ? (
          <>
            <SkeletonChart />
            <LoadingAnnouncement />
          </>
        ) : trend.length === 0 ? (
          <ChartEmptyState message="No grading periods with data yet." isFiltered={isFiltered} onClear={clearFilters} />
        ) : (
          <div className={frameClass}>
            <ChartFieldToggles fields={BAND_SEGMENT_SPEC} hidden={hiddenBands} onToggle={toggleBand} label="Bands" />
            {/* The same BarChart as the Overview tab, once per period,
                against ONE shared maximum. A vertical stacked column made
                every period a different-looking shape; this makes the
                period-to-period comparison the literal reading direction. */}
            <ChartCardRow>
              {periodDistributionCharts.map((period) => (
                <ChartCard
                  key={period.periodName}
                  title={period.periodName}
                  description={`${period.total} assessed`}
                  legend={visibleSegmentSpec.map((seg) => ({ label: seg.label, color: seg.color }))}
                  interpretation={describeLargestShare(period.rows, { total: period.total })}
                  isEmpty={period.rows.length === 0}
                  emptyMessage="All bands are hidden — pick one above to show it again."
                >
                  <BarChart rows={period.rows} maxValue={sharedPeriodMax} />
                </ChartCard>
              ))}
            </ChartCardRow>
          </div>
        )}
      </div>

      <div className="record-section">
        {atRiskShiftCallout && <p style={{ fontWeight: 500, color: 'var(--color-text)' }}>{atRiskShiftCallout}</p>}
        <div className={frameClass}>
          <ChartCard
            title="At-Risk Share Over Time"
            description="Percentage of assessed students in the At Risk band — accounts for the roster changing size period to period, which raw counts don't."
            legend={[{ label: 'At-risk share of assessed students', color: 'var(--band-at-risk-high)' }]}
            interpretation={describeTrend(atRiskPercentPoints, { subject: 'The at-risk share', unit: '%', noun: 'points' })}
            isEmpty={atRiskPercentPoints.length < 2}
            emptyMessage="Need at least two grading periods of data to show a trend."
          >
            {/* A risk-band chart, so it takes the ramp's most severe step
                rather than the house blue. */}
            <LineChart points={atRiskPercentPoints} color="var(--band-at-risk-high)" formatValue={formatPercent} />
          </ChartCard>
        </div>
      </div>
    </div>
  )

  const attendanceTab = (
    <div>
      <div className="record-section">
        {!attendance ? (
          <>
            <SkeletonChart />
            <LoadingAnnouncement />
          </>
        ) : (
          <div className={frameClass}>
            <ChartCard
              title="Attendance: At Risk vs. Everyone Else"
              description="Whether attendance is actually worse for at-risk students specifically, not just a single school-wide average."
              /* No separate `legend` prop: the ChartFieldToggles row in
                 `actions` already carries the same swatches and labels, and
                 is interactive on top of that. Rendering both would show the
                 colour key twice on one card. */
              interpretation={describeGap(cohortSeries?.[0]?.points, cohortSeries?.[1]?.points, {
                labelA: cohortSeries?.[0]?.label,
                labelB: cohortSeries?.[1]?.label,
              })}
              isEmpty={!cohortSeries || cohortSeries.length === 0 || attendance.byRiskCohort.length === 0}
              actions={<ChartFieldToggles fields={cohortFields} hidden={hiddenCohorts} onToggle={toggleCohort} label="Cohorts" />}
            >
              {/* Two lines, so the legend earns its place here. */}
              <LineChart series={cohortSeries} formatValue={formatPercent} />
            </ChartCard>
          </div>
        )}
      </div>

      <div className="record-section">
        {!attendance ? null : (
          <div className={frameClass}>
            {/* Bars on a 0-100% axis against the required rate, matching the
                student's own Attendance Trend chart exactly — the same form,
                legend and recommendation line, so a counsellor and a student
                looking at "attendance per period" are reading the same
                picture. */}
            <ChartCard
              title="Attendance Trend"
              description="Overall attendance rate per grading period, for whichever students the filters above select, against the required rate."
              legend={[
                { label: `At or above required (${attendanceThresholdText})`, color: 'var(--chart-blue)' },
                { label: `Below required (${attendanceThresholdText})`, color: 'var(--band-at-risk-high)' },
              ]}
              interpretation={describeTrendAgainstThreshold(attendancePoints, {
                subject: 'Attendance',
                unit: '%',
                noun: 'points',
                threshold: requiredAttendance,
                thresholdLabel: `the required rate of ${attendanceThresholdText}`,
              })}
              isEmpty={attendancePoints.length === 0}
            >
              <ColumnChart
                points={attendancePoints}
                formatValue={formatPercent}
                reference={
                  requiredAttendance != null
                    ? {
                        value: requiredAttendance,
                        label: `the required rate of ${attendanceThresholdText}`,
                        shortLabel: `Required ${attendanceThresholdText}`,
                      }
                    : null
                }
              />
            </ChartCard>
          </div>
        )}
      </div>

      <div className="record-section">
        {!lowestSections ? (
          <>
            <SkeletonChart />
            <LoadingAnnouncement />
          </>
        ) : (
          <div className={frameClass}>
            {/* A comparison across sections, so bars rather than a table of
                numbers — relative length answers "which section is worst"
                faster than reading a column of percentages. */}
            <ChartCard
              title="Lowest-Attendance Sections"
              description="Worst first, for the selected grading period."
              legend={[
                { label: `At or above required (${attendanceThresholdText})`, color: 'var(--chart-blue)' },
                { label: `Below required (${attendanceThresholdText})`, color: 'var(--band-at-risk-high)' },
              ]}
              isEmpty={lowestSections.length === 0}
              emptyMessage="No attendance recorded for this period yet."
              interpretation={
                lowestSections.length > 0
                  ? `Lowest is ${
                      lowestSections[0].gradeLevel != null
                        ? `Grade ${lowestSections[0].gradeLevel} - ${lowestSections[0].sectionName}`
                        : lowestSections[0].sectionName
                    } at ${formatPercent(lowestSections[0].attendanceRate)}.`
                  : null
              }
            >
              <BarChart rows={lowestSectionBars} maxValue={100} formatValue={formatPercent} />
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  )

  const interventionsTab = (
    <div>
      <div className="record-section">
        <h2>Intervention Effectiveness</h2>
        {!effectiveness ? (
          <>
            <SkeletonTable rows={4} columns={4} />
            <LoadingAnnouncement />
          </>
        ) : effectiveness.overall.total === 0 ? (
          <ChartEmptyState message="No interventions have been logged yet." isFiltered={isFiltered} onClear={clearFilters} />
        ) : (
          <div className={frameClass}>
            <StatRow>
              <StatCard
                icon={HeartHandshake}
                value={effectiveness.overall.resolutionRate != null ? formatPercent(effectiveness.overall.resolutionRate) : '—'}
                label="Resolution rate (of closed interventions)"
                variant="positive"
              />
              <StatCard icon={HeartHandshake} value={effectiveness.overall.counts.resolved} label="Resolved" variant="positive" />
              <StatCard icon={HeartHandshake} value={effectiveness.overall.counts.escalated} label="Escalated" variant="negative" />
              <StatCard
                icon={HeartHandshake}
                value={effectiveness.overall.counts.open + effectiveness.overall.counts.monitoring}
                label="Still open / monitoring"
                variant="info"
              />
            </StatRow>

            {/* Only worth a breakdown once there's more than one type to
                tell apart — with a single type, it's identical to the
                overall row above. */}
            {effectiveness.byType.length > 1 &&
              effectiveness.byType.map((row) => (
                <div key={row.interventionType} style={{ marginTop: 'var(--space-4)' }}>
                  <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: 'var(--space-2)' }}>
                    {INTERVENTION_TYPE_LABELS[row.interventionType] || row.interventionType}
                  </h3>
                  <StatRow compact>
                    <StatCard
                      icon={HeartHandshake}
                      value={row.resolutionRate != null ? formatPercent(row.resolutionRate) : '—'}
                      label="Resolution rate"
                      variant="positive"
                    />
                    <StatCard icon={HeartHandshake} value={row.counts.resolved} label="Resolved" variant="positive" />
                    <StatCard icon={HeartHandshake} value={row.counts.escalated} label="Escalated" variant="negative" />
                  </StatRow>
                </div>
              ))}

            {effectiveness.byType.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <DataTable
                  columns={[
                    {
                      key: 'type',
                      header: 'Intervention Type',
                      render: (row) => INTERVENTION_TYPE_LABELS[row.interventionType] || row.interventionType,
                    },
                    { key: 'resolved', header: 'Resolved', align: 'right', render: (row) => row.counts.resolved },
                    { key: 'escalated', header: 'Escalated', align: 'right', render: (row) => row.counts.escalated },
                    {
                      key: 'open',
                      header: 'Open / Monitoring',
                      align: 'right',
                      render: (row) => row.counts.open + row.counts.monitoring,
                    },
                    {
                      key: 'rate',
                      header: 'Resolution Rate',
                      align: 'right',
                      render: (row) => (row.resolutionRate != null ? formatPercent(row.resolutionRate) : fieldValue(null)),
                    },
                  ]}
                  rows={effectiveness.byType}
                  rowKey={(row) => row.interventionType}
                  emptyState={<p>No interventions logged for this period yet.</p>}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="record-section">
        <h2>Intervention Volume Over Time</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>How many interventions were logged each grading period.</p>
        {!effectiveness ? null : (
          <div className={frameClass}>
            <ChartCard
              title="Intervention Volume Over Time"
              description="How many interventions were logged each grading period."
              legend={[{ label: 'Interventions logged', color: 'var(--chart-blue)' }]}
              interpretation={describeTrend(interventionVolumePoints, {
                subject: 'Intervention volume',
                noun: 'interventions',
              })}
              isEmpty={interventionVolumePoints.length < 2}
              emptyMessage="Need at least two grading periods of data to show a trend."
            >
              <LineChart
                points={interventionVolumePoints}
                formatValue={(v) => String(v)}
                yMin={0}
                yMax={interventionVolumeMax}
              />
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  )

  const factorsTab = (
    <div>
      <div className="record-section">
        {loading || !factors ? (
          <>
            <SkeletonChart />
            <LoadingAnnouncement />
          </>
        ) : (
          <div className={frameClass}>
            <ChartCard
              title="Most Common Triggered Factors"
              description="Share of assessed students who triggered each factor this grading period — where to focus support school-wide."
              /* No separate `legend` prop: the ChartFieldToggles row in
                 `actions` already carries the same swatches and labels, and
                 is interactive on top of that. Rendering both would show the
                 colour key twice on one card. */
              interpretation={
                factorBars.length > 0
                  ? `Most common factor is ${factorBars[0].label}, triggered by ${factorBars[0].detail}.`
                  : null
              }
              isEmpty={factors.every((f) => f.count === 0) || factorBars.length === 0}
              emptyMessage={
                factors.every((f) => f.count === 0)
                  ? 'No risk factors triggered this period.'
                  : 'All factors are hidden — pick one above to show it again.'
              }
              actions={<ChartFieldToggles fields={factorToggleFields} hidden={hiddenFactors} onToggle={toggleFactor} label="Factors" />}
            >
              {/* Not a risk-band chart — factors aren't bands — so it takes
                  the house blue rather than the severity ramp. */}
              <BarChart rows={factorBars} formatValue={formatPercent} />
            </ChartCard>
          </div>
        )}
      </div>

      <div className="record-section">
        <h2>Factors Over Time</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>Whether each factor is becoming more or less common period over period.</p>
        {!factorsTrendData ? (
          <>
            <SkeletonChart />
            <LoadingAnnouncement />
          </>
        ) : factorSparklines.length === 0 ? (
          <ChartEmptyState
            message="Need at least two grading periods of data to show a trend."
            isFiltered={isFiltered || hiddenFactors.size > 0}
            onClear={() => {
              clearFilters()
              setHiddenFactors(new Set())
            }}
          />
        ) : (
          /* Four factors is more lines than one chart can carry (max 3), so
             this is small multiples of the SAME line chart — one per factor
             — rather than a fourth form. */
          <div className={frameClass}>
            <ChartCardRow>
              {factorSparklines.map((f) => (
                <ChartCard
                  key={f.key}
                  title={f.label}
                  description={`Now ${f.latest}% of assessed students`}
                  legend={[{ label: f.label, color: 'var(--chart-blue)' }]}
                  interpretation={describeTrend(f.points, { subject: 'This factor', unit: '%', noun: 'points' })}
                  actions={<TrendIcon trend={f.trend} />}
                >
                  <LineChart points={f.points} formatValue={formatPercent} />
                </ChartCard>
              ))}
            </ChartCardRow>
          </div>
        )}
      </div>

      <div className="record-section">
        <h2>Factors by Section</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>Which section a given factor concentrates in, this grading period.</p>
        {!factorsBySection ? (
          <>
            <SkeletonTable rows={4} columns={4} />
            <LoadingAnnouncement />
          </>
        ) : factorsBySection.length === 0 ? (
          <ChartEmptyState message="No sections with assessed students this period." isFiltered={isFiltered} onClear={clearFilters} />
        ) : (
          <div className={frameClass}>
            <DataTable
              columns={[
                { key: 'section', header: 'Section', render: (row) => row.group },
                ...FACTOR_ORDER.map((key) => ({
                  key,
                  header: factorsBySection[0].factors.find((f) => f.key === key)?.label || key,
                  align: 'right',
                  render: (row) => {
                    const match = row.factors.find((f) => f.key === key)
                    return match ? formatPercent(match.percentage) : fieldValue(null)
                  },
                })),
              ]}
              rows={factorsBySection}
              rowKey={(row) => row.group}
              emptyState={<p>No sections with assessed students this period.</p>}
            />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Analytics' }]} />

      <div className="page-header">
        <h1>Analytics</h1>
      </div>

      {/* The scope controls, in their own bar. Six selects had been
          crammed into page-header__actions, which is the row the page
          title sits in — so the title of the busiest screen in the app
          was sharing its line with six dropdowns. */}
      {/* On a phone these six selects stack into roughly 800px of chrome
          before any data — the first chart used to sit 1369px down the
          scroller, which is most of why the charts were reported as "not
          visible". They collapse behind a disclosure instead.

          Gated in JSX rather than hidden with CSS on purpose: `display:
          none` would leave six selects in the tab order and in the
          accessibility tree, so the wall would still be there for a
          keyboard or screen-reader user, just invisible.

          Collapsing them loses no information about the current scope,
          because the chip row immediately below always names the active
          filters and is never collapsed. */}
      {isPhone && (
        <button
          type="button"
          className="filter-bar__summary"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="analytics-filters"
        >
          <SlidersHorizontal size={15} strokeWidth={1.75} />
          Filters
          {activeFilterChips.length > 0 && <span className="pill pill--info">{activeFilterChips.length}</span>}
          <ChevronDown
            size={15}
            strokeWidth={2}
            className={`filter-bar__summary-chevron${filtersOpen ? ' is-open' : ''}`}
          />
        </button>
      )}
      <div className="filter-bar" id="analytics-filters" hidden={isPhone && !filtersOpen}>
        <label>
          Grading Period
          <select value={filters.gradingPeriodId} onChange={(e) => setFilter('gradingPeriodId', e.target.value)}>
            <option value="">Current</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section
          <select value={filters.sectionId} onChange={(e) => setFilter('sectionId', e.target.value)}>
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                Grade {s.grade_level} - {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Grade Level
          <select value={filters.gradeLevel} onChange={(e) => setFilter('gradeLevel', e.target.value)}>
            <option value="">All grades</option>
            {gradeLevels.map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </label>
        <label>
          Strand
          <select value={filters.strand} onChange={(e) => setFilter('strand', e.target.value)}>
            <option value="">All strands</option>
            {strands.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Risk Band
          <select value={filters.riskBand} onChange={(e) => setFilter('riskBand', e.target.value)}>
            <option value="">All bands</option>
            {RISK_BAND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Break down by
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="">Whole school</option>
            <option value="section">Section</option>
            <option value="gradeLevel">Grade level</option>
          </select>
        </label>
      </div>

      {/* Scope on the left, exports on the right — deliberately the same row,
          because the exports carry exactly the filters named beside them.
          Seeing "Filtered by: Strand ABM" directly next to "Export PDF" is
          what stops a narrowed report being mistaken for a school-wide one. */}
      <div className="analytics-toolbar">
        <div className="filter-summary">
          {isFiltered ? (
            <>
              <span className="filter-summary__label">Filtered by</span>
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="filter-chip"
                  onClick={() => setFilter(chip.key, '')}
                  title="Remove this filter"
                >
                  {chip.label}
                  <X size={11} strokeWidth={2.5} />
                </button>
              ))}
              <button type="button" className="filter-chip__clear" onClick={clearFilters}>
                Clear all
              </button>
            </>
          ) : (
            <span className="filter-summary__label">Showing all students</span>
          )}
        </div>

        <div className="analytics-toolbar__exports">
          <button type="button" className="btn-subtle" onClick={() => handleExport('pdf')} disabled={exporting !== null}>
            <FileText size={14} strokeWidth={1.75} />
            {exporting === 'pdf' ? 'Generating…' : 'Export PDF'}
          </button>
          <button type="button" className="btn-subtle" onClick={() => handleExport('excel')} disabled={exporting !== null}>
            <FileSpreadsheet size={14} strokeWidth={1.75} />
            {exporting === 'excel' ? 'Generating…' : 'Export Excel'}
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview', icon: LayoutGrid, content: overviewTab },
          { key: 'trends', label: 'Trends', icon: TrendingUp, content: trendsTab },
          { key: 'attendance', label: 'Attendance', icon: CalendarCheck, content: attendanceTab },
          { key: 'interventions', label: 'Interventions', icon: HeartHandshake, content: interventionsTab },
          { key: 'factors', label: 'Factors', icon: AlertTriangle, content: factorsTab },
        ]}
      />
    </div>
  )
}
