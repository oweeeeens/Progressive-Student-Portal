import { useEffect, useState } from 'react'
import { Users, CheckCircle2, Clock, CircleDashed, BookOpen } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { SkeletonTable } from '../components/Skeleton'
import { StatusPill } from '../components/StatusPill'
import { NoAssignmentNotice } from '../components/NoAssignmentNotice'
import { ReportExportButtons } from '../components/reports/ReportExportButtons'
import { defaultSelection } from '../utils/defaultSelection'
import { GRADE_STATUS_LABELS, GRADE_STATUS_VARIANTS } from '../utils/gradeMatrix'

// Class Grade Report — the panel's report for a subject teacher: the
// learners ENROLLED in each of the teacher's own classes, with every
// grading period's grade and where it is in the approval chain.
// GET /api/reports/class-grades (reportController.classGrades): the class's
// teacher (by assignment) or the admin.

function statDetails(data) {
  const c = data.statusCounts
  const inChain = c.submitted + c.principal_verified + c.rejected
  return {
    enrolled: {
      title: 'Learners enrolled',
      subtitle: data.studentCount,
      definition: 'Active learners enrolled in this class (class enrollment, from their section).',
    },
    finalized: {
      title: 'Grades finalized',
      subtitle: c.finalized,
      definition: 'Grades the adviser has put into the official record.',
    },
    inChain: {
      title: 'Grades in the approval chain',
      subtitle: inChain,
      definition: 'Submitted, but not finalized yet.',
      breakdown: [
        { label: 'Submitted (with the principal)', value: c.submitted },
        { label: 'Verified by the principal (with the adviser)', value: c.principal_verified },
        { label: 'Returned to the teacher', value: c.rejected },
        { label: 'In the chain', value: inChain, isTotal: true },
      ],
    },
    none: {
      title: 'Not submitted',
      subtitle: c.none,
      definition: 'Learner-and-period cells with no grade submitted yet.',
      rules: ['Counted only for the periods this class runs in.'],
    },
  }
}

// The picker's "every class" choice (panel item 4b: "students in EACH of the
// teacher's own class offerings").
const ALL = 'all'

// One class's table columns: each grading period it runs, as grade + stage.
function columnsFor(periods) {
  return [
    { key: 'n', header: '#', render: (r) => r.index },
    { key: 'name', header: 'Learner', primary: true, plainText: (r) => r.name, render: (r) => <span className="cell-primary">{r.name}</span> },
    ...periods.map((p, i) => ({
      key: `p${i}`,
      header: p.periodName,
      render: (r) =>
        r.cells[i] ? (
          <span className="report-grade-cell">
            <strong>{r.cells[i].value}</strong>
            <StatusPill label={GRADE_STATUS_LABELS[r.cells[i].status]} variant={GRADE_STATUS_VARIANTS[r.cells[i].status]} />
          </span>
        ) : (
          <span className="text-muted">Not submitted</span>
        ),
    })),
    { key: 'avg', header: 'Finalized average', align: 'center', render: (r) => fieldValue(r.finalizedAverage) },
  ]
}

function ClassTable({ data }) {
  if (data.periods.length === 0) return <p className="help-text">This class runs in no grading period.</p>
  return (
    <DataTable
      columns={columnsFor(data.periods)}
      rows={data.rows.map((r, i) => ({ ...r, index: i + 1 }))}
      rowKey={(r) => r.studentId}
      emptyState={<p>No learners are enrolled in this class.</p>}
    />
  )
}

export function ClassGradesReportPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [offerings, setOfferings] = useState(null)
  const [offeringId, setOfferingId] = useState('')
  const [data, setData] = useState(null)
  // "All my classes" (or, for the admin, all classes of one section or all).
  const [allData, setAllData] = useState(null)
  const [sections, setSections] = useState([])
  const [allSectionId, setAllSectionId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState(null)
  const { openFor, close, cardProps } = useStatExplainer('class-grades-stat-detail')

  // The admin chooses from every current class; a teacher opens on their own.
  useEffect(() => {
    api
      .get(isAdmin ? '/class-offerings/recordable' : '/class-offerings/mine')
      .then((res) => {
        setOfferings(res.classOfferings)
        setOfferingId((current) => current || defaultSelection(res.classOfferings, !isAdmin))
      })
      .catch((err) => setError(`Couldn't load your classes: ${err.message}`))
    if (isAdmin) {
      api
        .get('/sections')
        .then((res) => setSections(res.sections))
        .catch((err) => setError(`Couldn't load the sections: ${err.message}`))
    }
  }, [isAdmin])

  const allQuery = isAdmin && allSectionId ? `?sectionId=${allSectionId}` : ''
  const reportPath = offeringId === ALL ? `/reports/class-grades/all${allQuery}` : `/reports/class-grades?classOfferingId=${offeringId}`

  useEffect(() => {
    setData(null)
    setAllData(null)
    if (!offeringId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get(reportPath)
      .then((res) => {
        if (cancelled) return
        if (offeringId === ALL) setAllData(res)
        else setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [offeringId, reportPath])

  const details = data ? statDetails(data) : {}

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Reports' }, { label: 'Class Grades' }]} />
      <div className="page-header">
        <h1>Class Grade Report</h1>
        <div className="page-header__actions">
          <label>
            <BookOpen size={16} strokeWidth={1.75} /> Class
            <select value={offeringId} onChange={(e) => setOfferingId(e.target.value)}>
              {(isAdmin || !offeringId) && <option value="">— Choose a class —</option>}
              {(isAdmin || (offerings || []).length > 1) && <option value={ALL}>{isAdmin ? 'All classes' : 'All my classes'}</option>}
              {(offerings || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.section_name} – {o.subject_name}
                </option>
              ))}
            </select>
          </label>
          {isAdmin && offeringId === ALL && (
            <label>
              Section
              <select value={allSectionId} onChange={(e) => setAllSectionId(e.target.value)}>
                <option value="">All sections</option>
                {sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    Grade {sec.grade_level} – {sec.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ReportExportButtons path={reportPath} disabled={!data && !allData} onError={setExportError} />
        </div>
      </div>

      <NoAssignmentNotice kind="class" />
      {error && <Alert>{error}</Alert>}
      {exportError && <Alert>{exportError}</Alert>}
      {offerings && offerings.length === 0 && !isAdmin && (
        <p className="help-text">You do not teach a class this school year, so there is no class report to show.</p>
      )}
      {isAdmin && !offeringId && <p className="help-text">Choose a class to see its grade report.</p>}
      {loading && <SkeletonTable rows={8} columns={5} />}

      {data && (
        <>
          <StatRow>
            <StatCard icon={Users} value={data.studentCount} label="Learners enrolled" {...cardProps('enrolled')} />
            <StatCard icon={CheckCircle2} value={data.statusCounts.finalized} label="Grades finalized" variant="positive" {...cardProps('finalized')} />
            <StatCard
              icon={Clock}
              value={data.statusCounts.submitted + data.statusCounts.principal_verified + data.statusCounts.rejected}
              label="In the approval chain"
              {...cardProps('inChain')}
            />
            <StatCard icon={CircleDashed} value={data.statusCounts.none} label="Not submitted" {...cardProps('none')} />
          </StatRow>
          <StatDetail id="class-grades-stat-detail" detail={details[openFor()]} onClose={close} />

          <p className="text-muted mb-3">
            {data.offering.subjectName} · Grade {data.offering.gradeLevel} – {data.offering.sectionName} · School year{' '}
            {fieldValue(data.offering.schoolYear)} · Teacher {fieldValue(data.offering.teacherName)}
          </p>
          <ClassTable data={data} />
        </>
      )}

      {allData && (
        <>
          <p className="text-muted mb-3">
            {allData.scopeLabel} · {allData.classes.length} class{allData.classes.length === 1 ? '' : 'es'} · School year{' '}
            {fieldValue(allData.schoolYear)}
          </p>
          {allData.classes.length === 0 && <p className="help-text">No classes to show.</p>}
          {allData.classes.map((cls) => {
            const c = cls.statusCounts
            return (
              <section key={cls.offering.id} className="record-section" aria-label={`${cls.offering.sectionName} ${cls.offering.subjectName}`}>
                <h2>
                  {cls.offering.subjectName} · Grade {cls.offering.gradeLevel} – {cls.offering.sectionName}
                </h2>
                <p className="help-text mb-3">
                  {cls.studentCount} learners enrolled · {c.finalized} finalized · {c.submitted + c.principal_verified + c.rejected} in the
                  approval chain · {c.none} not submitted{isAdmin ? ` · Teacher ${cls.offering.teacherName || '—'}` : ''}
                </p>
                <ClassTable data={cls} />
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
