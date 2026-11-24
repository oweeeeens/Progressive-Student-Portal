import { useEffect, useState } from 'react'
import { Users, CheckCircle2, CircleDashed, AlertTriangle } from 'lucide-react'
import { api } from '../../api/client'
import { Alert } from '../Alert'
import { StatCard, StatRow } from '../StatCard'
import { StatDetail } from '../StatDetail'
import { useStatExplainer } from '../../hooks/useStatExplainer'
import { DataTable, fieldValue } from '../table/DataTable'
import { SkeletonTable } from '../Skeleton'
import { ReportExportButtons } from '../reports/ReportExportButtons'

// Analytics → Monitoring (panel revision, 2026-11-18), for the admin and the
// principal: the school at a glance for one grading period —
//   enrollment per section (learners, classes, class enrollments),
//   grade submission/approval status per class, and
//   at-risk learners per section (risk score above 0, as everywhere on
//   Analytics).
// GET /api/analytics/monitoring (reportController.monitoring). The period
// follows the page's own grading-period filter.

function statDetails(data) {
  const t = data.totals
  return {
    learners: {
      title: 'Learners',
      subtitle: t.learners,
      definition: `Active, enrolled learners in a section of school year ${data.period.schoolYear || ''} — the same learners the Enrolled Student List and the class rosters count.`,
      rules: ['A learner marked dropped, transferred or graduated is not counted, and is no longer on any class roster.'],
      breakdown: [
        { label: 'Learners', value: t.learners },
        { label: 'Class enrollments (learner × class)', value: t.enrollments },
      ],
    },
    finalized: {
      title: 'Grades finalized',
      subtitle: t.finalized,
      definition: `Grades in the official record for ${data.period.name}, over the learners enrolled in each class.`,
      breakdown: [
        { label: 'Submitted (with the principal)', value: t.submitted },
        { label: 'Verified (with the adviser)', value: t.verified },
        { label: 'Returned to the teacher', value: t.rejected },
        { label: 'Finalized', value: t.finalized, isTotal: true },
      ],
    },
    missing: {
      title: 'Grades missing',
      subtitle: t.missing,
      definition: `Enrolled learners with no grade submitted at all for ${data.period.name}, summed over every class that runs in it.`,
      rules: ['A class not taught in this period (a Grade 12 subject runs one term) is not counted.'],
    },
    atRisk: {
      title: 'At risk',
      subtitle: `${t.atRisk.total} of ${t.assessed}`,
      definition: 'Learners with any risk factor triggered (risk score above 0) in this period, out of those assessed — the same At Risk as everywhere on Analytics.',
      rules: ['In the per-section table, each learner is counted under the section they are in now. The assessment does not record which section a learner was in at the time, so a learner who has since moved is shown under their new section.'],
      breakdown: [
        { label: 'High', value: t.atRisk.high },
        { label: 'Medium', value: t.atRisk.medium },
        { label: 'Low', value: t.atRisk.low },
      ],
    },
  }
}

export function MonitoringTab({ gradingPeriodId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState(null)
  const [loading, setLoading] = useState(true)
  const { openFor, close, cardProps } = useStatExplainer('monitoring-stat-detail')
  const path = `/analytics/monitoring${gradingPeriodId ? `?gradingPeriodId=${gradingPeriodId}` : ''}`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get(path)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message)
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (loading && !data) return <SkeletonTable rows={6} columns={6} />
  if (error) return <Alert>{error}</Alert>
  if (!data) return null
  const t = data.totals
  const details = statDetails(data)

  return (
    <div>
      <div className="button-row button-row--spaced mb-3">
        <p className="help-text m-0">
          {data.period.name}, school year {fieldValue(data.period.schoolYear)}. Use the grading-period filter above to look at another.
        </p>
        <ReportExportButtons path={path} onError={setExportError} subject="monitoring" />
      </div>
      {exportError && <Alert>{exportError}</Alert>}

      <StatRow>
        <StatCard icon={Users} value={t.learners} label="Learners" {...cardProps('learners')} />
        <StatCard icon={CheckCircle2} value={t.finalized} label="Grades finalized" variant="positive" {...cardProps('finalized')} />
        <StatCard icon={CircleDashed} value={t.missing} label="Grades missing" variant={t.missing > 0 ? 'warning' : undefined} {...cardProps('missing')} />
        <StatCard icon={AlertTriangle} value={`${t.atRisk.total} / ${t.assessed}`} label="At risk / assessed" {...cardProps('atRisk')} />
      </StatRow>
      <StatDetail id="monitoring-stat-detail" detail={details[openFor()]} onClose={close} />

      <h3 className="mt-5">Enrollment and at-risk learners per section</h3>
      <DataTable
        columns={[
          { key: 'section', header: 'Section', primary: true, plainText: (s) => s.sectionName, render: (s) => <span className="cell-primary">Grade {s.gradeLevel} – {s.sectionName}</span> },
          { key: 'adviser', header: 'Adviser', render: (s) => fieldValue(s.adviserName) },
          { key: 'learners', header: 'Learners', align: 'right', render: (s) => s.learners },
          { key: 'classes', header: 'Classes', align: 'right', render: (s) => s.classes },
          { key: 'enrollments', header: 'Enrollments', align: 'right', render: (s) => s.enrollments },
          { key: 'atRisk', header: 'At risk', align: 'right', render: (s) => <strong>{s.atRisk.total}</strong> },
          { key: 'split', header: 'High / Med / Low', align: 'right', render: (s) => `${s.atRisk.high} / ${s.atRisk.medium} / ${s.atRisk.low}` },
          { key: 'assessed', header: 'Assessed', align: 'right', render: (s) => s.assessed },
        ]}
        rows={data.sections}
        rowKey={(s) => s.sectionId}
        emptyState={<p>No sections in this school year yet.</p>}
      />

      <h3 className="mt-5">Grade status per class — {data.period.name}</h3>
      <p className="help-text mb-3">
        Counted over the learners enrolled in each class. Missing = enrolled learners with no grade submitted for this period.
      </p>
      <DataTable
        columns={[
          { key: 'class', header: 'Class', primary: true, plainText: (c) => `${c.sectionName} ${c.subjectName}`, render: (c) => <span className="cell-primary">{c.subjectName}</span> },
          { key: 'section', header: 'Section', render: (c) => `Grade ${c.gradeLevel} – ${c.sectionName}` },
          { key: 'teacher', header: 'Teacher', render: (c) => fieldValue(c.teacherName) },
          { key: 'enrolled', header: 'Enrolled', align: 'right', render: (c) => c.enrolled },
          { key: 'submitted', header: 'Submitted', align: 'right', render: (c) => c.submitted },
          { key: 'verified', header: 'Verified', align: 'right', render: (c) => c.verified },
          { key: 'finalized', header: 'Finalized', align: 'right', render: (c) => c.finalized },
          { key: 'rejected', header: 'Returned', align: 'right', render: (c) => c.rejected },
          { key: 'missing', header: 'Missing', align: 'right', render: (c) => (c.missing > 0 ? <strong>{c.missing}</strong> : 0) },
        ]}
        rows={data.classes}
        rowKey={(c) => c.offeringId}
        emptyState={<p>No class runs in this grading period.</p>}
      />
    </div>
  )
}
