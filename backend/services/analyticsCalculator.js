// Pure aggregation logic for the Analytics module — no database access of
// its own (same calculator-vs-DB-facing split as riskCalculator.js vs
// riskEngine.js, and academicProgressCalculator.js vs
// academicProgressController.js). Deliberately built on top of
// riskCalculator.evaluateFactors and academicProgressCalculator.determineBand
// rather than re-deriving band/factor logic here — the whole point of this
// module is a school-wide ROLLUP of numbers the per-student views already
// compute, so it must never be able to disagree with them.
const { evaluateFactors } = require('./riskCalculator');
const { determineBand } = require('./academicProgressCalculator');
const { BANDS, FACTOR_PRIORITY } = require('../config/academicProgress');

const BUCKET_KEYS = ['at_risk_high', 'at_risk_medium', 'at_risk_low', 'average', 'performing_well', 'not_yet_calculated'];
const BUCKET_LABELS = {
  at_risk_high: 'At Risk — High',
  at_risk_medium: 'At Risk — Medium',
  at_risk_low: 'At Risk — Low',
  average: 'Average / Steady',
  performing_well: 'Performing Well',
  not_yet_calculated: 'Not Yet Calculated',
};

const FACTOR_LABELS = {
  low_grade: 'Low grade',
  declining_grade: 'Declining grade trend',
  low_attendance: 'Low attendance',
  declining_attendance: 'Declining attendance trend',
};

function emptyBucketCounts() {
  return Object.fromEntries(BUCKET_KEYS.map((k) => [k, 0]));
}

// The one place the Analytics page's filters are implemented. Every
// endpoint runs its rows through this before handing them to any of the
// rollup functions below, which is why a filter means the same thing on
// every tab and why the filtered numbers can't drift apart between charts.
//
// Takes rows in any of analyticsModel's shapes — they all deliberately
// carry the same four filterable dimensions (see that file's header).
// An absent/empty filter value means "don't filter on this dimension," so
// {} returns the rows untouched.
//
// riskBand is special: it's a DERIVED value (classifyRow), not a stored
// column, so it can only be filtered here, after classification — never in
// SQL. 'at_risk_any' is a convenience that matches all three At Risk
// levels at once, since "show me every at-risk student" is the question
// guidance staff actually ask; any other value matches one exact bucket.
function filterRows(rows, { sectionId, gradeLevel, strand, riskBand } = {}) {
  return rows.filter((row) => {
    if (sectionId && row.current_section_id !== sectionId) return false;
    if (gradeLevel && row.grade_level !== gradeLevel) return false;
    if (strand && row.strand !== strand) return false;
    if (riskBand) {
      const bucket = classifyRow(row);
      if (riskBand === 'at_risk_any') {
        if (!bucket.startsWith('at_risk_')) return false;
      } else if (bucket !== riskBand) {
        return false;
      }
    }
    return true;
  });
}

// One row (from analyticsModel's assessment queries) -> one of the six
// bucket keys above. Splits At Risk into its existing Low/Medium/High
// (risk_assessments.risk_level, unchanged) rather than collapsing it to one
// "At Risk" bucket — the distribution chart is exactly the place a school
// wants that detail.
function classifyRow(row) {
  if (row.risk_level == null) return 'not_yet_calculated';
  const band = determineBand({
    riskScore: row.risk_score,
    averageGrade: row.average_grade != null ? Number(row.average_grade) : null,
    gradeTrend: row.grade_trend != null ? Number(row.grade_trend) : null,
  });
  return band === BANDS.AT_RISK ? `at_risk_${row.risk_level}` : band;
}

function tallyBuckets(rows) {
  const counts = emptyBucketCounts();
  for (const row of rows) counts[classifyRow(row)] += 1;
  return counts;
}

// groupBy: undefined -> just the overall tally. 'section' | 'gradeLevel' ->
// also a per-group breakdown, each with its own counts/total (a student
// with no current section falls into an explicit "Unassigned" group rather
// than being silently dropped).
function riskDistribution(rows, groupBy) {
  const overall = { counts: tallyBuckets(rows), total: rows.length };
  if (!groupBy) return { overall, breakdown: null };

  const groups = new Map();
  for (const row of rows) {
    const key =
      groupBy === 'section' ? row.section_name || 'Unassigned' : row.grade_level != null ? `Grade ${row.grade_level}` : 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const breakdown = [...groups.entries()]
    .map(([group, groupRows]) => ({ group, counts: tallyBuckets(groupRows), total: groupRows.length }))
    .sort((a, b) => a.group.localeCompare(b.group));

  return { overall, breakdown };
}

// rows: every assessment across a school year's periods (analyticsModel's
// getAssessmentsForSchoolYear) -> one bucket tally per period, oldest first.
function riskTrend(rows) {
  const periods = new Map();
  for (const row of rows) {
    if (!periods.has(row.grading_period_id)) {
      periods.set(row.grading_period_id, {
        periodId: row.grading_period_id,
        periodName: row.period_name,
        sequenceNumber: row.sequence_number,
        rows: [],
      });
    }
    periods.get(row.grading_period_id).rows.push(row);
  }
  return [...periods.values()]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((p) => ({ periodId: p.periodId, periodName: p.periodName, counts: tallyBuckets(p.rows), total: p.rows.length }));
}

// Re-derives triggered factors per student (same evaluateFactors call the
// per-student badge uses) and tallies how often each one fires across the
// given rows — "where should the school focus support." Percentage is of
// students who HAVE an assessment this period, not the whole roster
// (a student with no finalized data yet can't have triggered anything).
function topFactors(rows) {
  const counts = { low_grade: 0, declining_grade: 0, low_attendance: 0, declining_attendance: 0 };
  let assessedCount = 0;

  for (const row of rows) {
    if (row.risk_level == null) continue;
    assessedCount += 1;
    const factors = evaluateFactors({
      currentGrade: row.average_grade != null ? Number(row.average_grade) : null,
      gradeTrend: row.grade_trend != null ? Number(row.grade_trend) : null,
      currentAttendanceRate: row.attendance_rate != null ? Number(row.attendance_rate) : null,
      attendanceTrend: row.attendance_trend != null ? Number(row.attendance_trend) : null,
    });
    for (const factor of factors) counts[factor.key] += 1;
  }

  return Object.entries(counts)
    .map(([key, count]) => ({
      key,
      label: FACTOR_LABELS[key],
      count,
      percentage: assessedCount > 0 ? Math.round((count / assessedCount) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// rows: analyticsModel.getAssessmentsForPeriod's rows (now including
// first_name/last_name) -> the N students most worth an admin/principal/
// guidance_counselor's attention right now, each with their single top
// triggered factor (same FACTOR_PRIORITY ranking getTopConcern uses for the
// per-student badge, so "top factor" never disagrees between the two
// views). 'low' risk students are excluded — this list is for the ones
// that actually warrant a look, not every flagged factor.
function topAtRiskStudents(rows, limit = 5) {
  const atRisk = rows
    .filter((row) => row.risk_level === 'high' || row.risk_level === 'medium')
    .sort((a, b) => b.risk_score - a.risk_score);

  return atRisk.slice(0, limit).map((row) => {
    const factors = evaluateFactors({
      currentGrade: row.average_grade != null ? Number(row.average_grade) : null,
      gradeTrend: row.grade_trend != null ? Number(row.grade_trend) : null,
      currentAttendanceRate: row.attendance_rate != null ? Number(row.attendance_rate) : null,
      attendanceTrend: row.attendance_trend != null ? Number(row.attendance_trend) : null,
    });
    const topFactor = FACTOR_PRIORITY.map((key) => factors.find((f) => f.key === key)).find(Boolean) || factors[0] || null;
    return {
      studentId: row.student_id,
      firstName: row.first_name,
      lastName: row.last_name,
      riskLevel: row.risk_level,
      topFactorLabel: topFactor ? FACTOR_LABELS[topFactor.key] : null,
    };
  });
}

// rows: analyticsModel.getAttendanceWithRiskByPeriod's rows (one per
// student per period, attendance tally + that period's risk inputs) ->
// each period's attendance rate split into the At Risk band vs everyone
// else — the actually-useful comparison this chart exists for (a single
// school-wide line can't show whether at-risk students specifically are
// the ones dragging attendance down). "At risk" is the BAND (riskScore >
// 0), evaluated per period since it can change period to period — not a
// student's current/latest status applied retroactively. A student with no
// assessment that period (risk_score null) is excluded from both cohorts
// rather than guessed into one.
function attendanceByRiskCohort(rows) {
  const periods = new Map();
  for (const row of rows) {
    if (!periods.has(row.grading_period_id)) {
      periods.set(row.grading_period_id, {
        periodId: row.grading_period_id,
        periodName: row.period_name,
        sequenceNumber: row.sequence_number,
        atRisk: { attended: 0, total: 0 },
        notAtRisk: { attended: 0, total: 0 },
      });
    }
    if (row.risk_score == null) continue;

    const period = periods.get(row.grading_period_id);
    const band = determineBand({
      riskScore: row.risk_score,
      averageGrade: row.average_grade != null ? Number(row.average_grade) : null,
      gradeTrend: row.grade_trend != null ? Number(row.grade_trend) : null,
    });
    const cohort = band === BANDS.AT_RISK ? period.atRisk : period.notAtRisk;
    cohort.attended += row.attended_days;
    cohort.total += row.total_days;
  }

  const rate = (c) => (c.total > 0 ? Math.round((c.attended / c.total) * 1000) / 10 : null);
  return [...periods.values()]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((p) => ({
      periodId: p.periodId,
      periodName: p.periodName,
      atRiskAttendanceRate: rate(p.atRisk),
      notAtRiskAttendanceRate: rate(p.notAtRisk),
    }));
}

// rows: analyticsModel.getAttendanceWithRiskByPeriod's rows -> one overall
// attendance rate per period, oldest first. The plain single-line version
// of attendanceByRiskCohort above, off the exact same rows: what used to be
// two separate SQL aggregates (school-wide and per-section) is now this one
// function, because scoping to a section is just a filterRows() call before
// it rather than a different query.
function attendanceRateByPeriod(rows) {
  const periods = new Map();
  for (const row of rows) {
    if (!periods.has(row.grading_period_id)) {
      periods.set(row.grading_period_id, {
        periodId: row.grading_period_id,
        periodName: row.period_name,
        sequenceNumber: row.sequence_number,
        attended: 0,
        total: 0,
      });
    }
    const period = periods.get(row.grading_period_id);
    period.attended += row.attended_days;
    period.total += row.total_days;
  }
  return [...periods.values()]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((p) => ({
      periodId: p.periodId,
      periodName: p.periodName,
      attendanceRate: p.total > 0 ? Math.round((p.attended / p.total) * 1000) / 10 : null,
    }));
}

// rows: analyticsModel.getStudentAttendanceForPeriod's rows -> one
// attendance rate per section, worst first — the Attendance tab's
// "lowest-attendance sections" table. Students with no section land in an
// explicit "Unassigned" group rather than being dropped, the same way
// riskDistribution's breakdown handles them.
function sectionAttendanceRates(rows) {
  const sections = new Map();
  for (const row of rows) {
    const key = row.current_section_id ?? 'unassigned';
    if (!sections.has(key)) {
      sections.set(key, {
        sectionId: row.current_section_id ?? null,
        sectionName: row.section_name || 'Unassigned',
        gradeLevel: row.grade_level ?? null,
        attended: 0,
        total: 0,
      });
    }
    const section = sections.get(key);
    section.attended += row.attended_days;
    section.total += row.total_days;
  }
  return [...sections.values()]
    .map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      gradeLevel: s.gradeLevel,
      attendanceRate: s.total > 0 ? Math.round((s.attended / s.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.attendanceRate - b.attendanceRate);
}

// rows: analyticsModel.getInterventionRows' rows -> how many interventions
// were logged in each grading period, oldest first.
function interventionVolumeByPeriod(rows) {
  const periods = new Map();
  for (const row of rows) {
    if (!periods.has(row.grading_period_id)) {
      periods.set(row.grading_period_id, {
        gradingPeriodId: row.grading_period_id,
        periodName: row.period_name,
        sequenceNumber: row.sequence_number,
        count: 0,
      });
    }
    periods.get(row.grading_period_id).count += 1;
  }
  return [...periods.values()]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((p) => ({ gradingPeriodId: p.gradingPeriodId, periodName: p.periodName, count: p.count }));
}

// rows: analyticsModel.getAssessmentsForSchoolYear's rows (the same data
// the Trends tab already fetches) -> topFactors(), once per period, so the
// Factors tab can show whether each factor is becoming more or less common
// over time. Reuses topFactors() itself rather than a second copy of the
// "re-derive factors and tally" logic.
function factorTrendByPeriod(rows) {
  const periods = new Map();
  for (const row of rows) {
    if (!periods.has(row.grading_period_id)) {
      periods.set(row.grading_period_id, {
        periodId: row.grading_period_id,
        periodName: row.period_name,
        sequenceNumber: row.sequence_number,
        rows: [],
      });
    }
    periods.get(row.grading_period_id).rows.push(row);
  }
  return [...periods.values()]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((p) => ({ periodId: p.periodId, periodName: p.periodName, factors: topFactors(p.rows) }));
}

// rows: analyticsModel.getAssessmentsForPeriod's rows (the same data the
// Overview tab's distribution already fetches) -> topFactors(), once per
// section — same "group, then reuse the one existing per-group function"
// shape as riskDistribution's groupBy='section' breakdown, so guidance
// staff can see which section a given factor concentrates in.
function sectionFactorBreakdown(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.section_name || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([group, groupRows]) => ({ group, factors: topFactors(groupRows) }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

// rows: analyticsModel.getInterventionRows' rows, one per logged
// intervention -> overall resolved-vs-escalated rate plus the same broken
// down by type. "Resolution rate" is resolved / (resolved + escalated) —
// open/monitoring are still pending, not yet an outcome, so they're shown
// as counts but don't enter the rate.
function interventionEffectiveness(rows) {
  const overallCounts = { open: 0, monitoring: 0, resolved: 0, escalated: 0 };
  const byTypeCounts = new Map();

  for (const row of rows) {
    overallCounts[row.status] += 1;
    if (!byTypeCounts.has(row.intervention_type)) {
      byTypeCounts.set(row.intervention_type, { open: 0, monitoring: 0, resolved: 0, escalated: 0 });
    }
    byTypeCounts.get(row.intervention_type)[row.status] += 1;
  }

  function withRate(counts) {
    const closed = counts.resolved + counts.escalated;
    const total = counts.open + counts.monitoring + counts.resolved + counts.escalated;
    return { counts, total, closed, resolutionRate: closed > 0 ? Math.round((counts.resolved / closed) * 1000) / 10 : null };
  }

  const byType = [...byTypeCounts.entries()]
    .map(([interventionType, counts]) => ({ interventionType, ...withRate(counts) }))
    .sort((a, b) => b.total - a.total);

  return { overall: withRate(overallCounts), byType };
}

module.exports = {
  BUCKET_KEYS,
  BUCKET_LABELS,
  FACTOR_LABELS,
  classifyRow,
  filterRows,
  riskDistribution,
  riskTrend,
  topFactors,
  interventionEffectiveness,
  interventionVolumeByPeriod,
  topAtRiskStudents,
  attendanceByRiskCohort,
  attendanceRateByPeriod,
  sectionAttendanceRates,
  factorTrendByPeriod,
  sectionFactorBreakdown,
};
