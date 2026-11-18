import { useEffect, useState } from 'react'
import { Users, BookOpen, CheckCircle2, Layers } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { Tabs } from '../components/Tabs'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { SkeletonTable } from '../components/Skeleton'
import { NoAssignmentNotice } from '../components/NoAssignmentNotice'
import { ReportExportButtons } from '../components/reports/ReportExportButtons'
import { defaultSelection } from '../utils/defaultSelection'

// Adviser Gradesheet — the panel's report: every learner in the adviser's
// own section × every subject, FINALIZED grades only, one table per grading
// period. GET /api/reports/gradesheet (reportController.gradesheet), which
// allows only the section's adviser (by assignment) or the admin.
//
// Only finalized grades — the official record — appear. A dash is a subject
// taught in that period whose grade is not finalized yet; a subject not
// taught in a period is simply not a column in that period's table.

// The stat cards' explanations, from the data already on the page.
function statDetails(data) {
  const total = data.periods.reduce((sum, p) => sum + p.cellCount, 0)
  const finalized = data.periods.reduce((sum, p) => sum + p.finalizedCells, 0)
  return {
    learners: {
      title: 'Learners',
      subtitle: data.studentCount,
      definition: 'Active learners whose current section is this one.',
      rules: ['A learner who moved to another section is listed on that section\'s gradesheet instead.'],
    },
    subjects: {
      title: 'Subjects',
      subtitle: data.subjects.length,
      definition: 'The section\'s active classes this school year.',
      rules: ['A Grade 12 subject that runs one term appears only in that term\'s table.'],
    },
    finalized: {
      title: 'Grades finalized',
      subtitle: `${finalized} of ${total}`,
      definition: 'Grades the adviser has finalized into the official record, across every grading period.',
      breakdown: data.periods.map((p) => ({ label: p.periodName, value: `${p.finalizedCells} of ${p.cellCount}` })),
      rules: ['Submitted and principal-verified grades are not counted: they are not official yet.'],
    },
  }
}

function PeriodTable({ period }) {
  if (period.subjects.length === 0) {
    return <p className="help-text">No subjects run in this grading period.</p>
  }
  const columns = [
    { key: 'n', header: '#', render: (r) => r.index },
    { key: 'name', header: 'Learner', primary: true, plainText: (r) => r.name, render: (r) => <span className="cell-primary">{r.name}</span> },
    ...period.subjects.map((s, i) => ({
      key: `s${i}`,
      // Plain text: DataTable labels each cell with it on a phone.
      header: s.subjectCode || s.subjectName,
      align: 'center',
      render: (r) => fieldValue(r.grades[i]),
    })),
    {
      key: 'avg',
      header: 'Average',
      align: 'center',
      render: (r) => (r.average === null ? fieldValue(null) : <strong>{r.average}</strong>),
    },
    { key: 'fin', header: 'Finalized', align: 'center', render: (r) => `${r.finalizedCount} of ${period.subjects.length}` },
  ]
  return (
    <>
      <p className="help-text mb-3">
        {period.finalizedCells} of {period.cellCount} grades finalized. — = taught this period, not finalized yet. Average is of the
        grades finalized so far.
      </p>
      <DataTable
        columns={columns}
        rows={period.rows.map((r, i) => ({ ...r, index: i + 1 }))}
        rowKey={(r) => r.studentId}
        emptyState={<p>No learners in this section.</p>}
      />
      {/* The key to the column headings. */}
      <p className="help-text mt-3">
        {period.subjects.map((s) => `${s.subjectCode || s.subjectName} = ${s.subjectName}${s.teacherName ? ` (${s.teacherName})` : ''}`).join(' · ')}
      </p>
    </>
  )
}

export function GradesheetReportPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [sections, setSections] = useState(null)
  const [sectionId, setSectionId] = useState('')
  const [currentPeriodId, setCurrentPeriodId] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState(null)
  const { openFor, close, cardProps } = useStatExplainer('gradesheet-stat-detail')

  // The admin chooses from every section; an adviser opens on their own.
  useEffect(() => {
    api
      .get(isAdmin ? '/sections' : '/sections/mine')
      .then((res) => {
        setSections(res.sections)
        setSectionId((current) => current || defaultSelection(res.sections, !isAdmin))
      })
      .catch((err) => setError(`Couldn't load your sections: ${err.message}`))
    api
      .get('/grading-periods/current')
      .then((res) => setCurrentPeriodId(res.gradingPeriod?.id ?? null))
      .catch(() => setCurrentPeriodId(null))
  }, [isAdmin])

  useEffect(() => {
    if (!sectionId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null) // a failed load must not leave another section's grades on screen
    api
      .get(`/reports/gradesheet?sectionId=${sectionId}`)
      .then((res) => {
        if (!cancelled) setData(res)
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
  }, [sectionId])

  const details = data ? statDetails(data) : {}
  const defaultTab = data && currentPeriodId && data.periods.some((p) => p.periodId === currentPeriodId) ? String(currentPeriodId) : undefined

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Reports' }, { label: 'Gradesheet' }]} />
      <div className="page-header">
        <h1>Adviser Gradesheet</h1>
        <div className="page-header__actions">
          <label>
            <Layers size={16} strokeWidth={1.75} /> Section
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {(isAdmin || !sectionId) && <option value="">— Choose a section —</option>}
              {(sections || []).map((s) => (
                <option key={s.id} value={s.id}>
                  Grade {s.grade_level} – {s.name}
                </option>
              ))}
            </select>
          </label>
          <ReportExportButtons path={`/reports/gradesheet?sectionId=${sectionId}`} disabled={!data} onError={setExportError} />
        </div>
      </div>

      <NoAssignmentNotice kind="section" />
      <p className="help-text mb-3">
        Finalized grades only — the official record. Grades still with the principal or waiting to be finalized do not appear here.
      </p>
      {error && <Alert>{error}</Alert>}
      {exportError && <Alert>{exportError}</Alert>}
      {sections && sections.length === 0 && !isAdmin && (
        <p className="help-text">You do not advise a section this school year, so there is no gradesheet to show.</p>
      )}
      {isAdmin && !sectionId && <p className="help-text">Choose a section to see its gradesheet.</p>}
      {loading && <SkeletonTable rows={8} columns={6} />}

      {data && (
        <>
          <StatRow>
            <StatCard icon={Users} value={data.studentCount} label="Learners" {...cardProps('learners')} />
            <StatCard icon={BookOpen} value={data.subjects.length} label="Subjects" {...cardProps('subjects')} />
            <StatCard
              icon={CheckCircle2}
              value={`${data.periods.reduce((s, p) => s + p.finalizedCells, 0)} / ${data.periods.reduce((s, p) => s + p.cellCount, 0)}`}
              label="Grades finalized"
              variant="positive"
              {...cardProps('finalized')}
            />
          </StatRow>
          <StatDetail id="gradesheet-stat-detail" detail={details[openFor()]} onClose={close} />

          <p className="text-muted mb-3">
            Grade {data.section.gradeLevel} – {data.section.name} · {data.section.strand} · School year {fieldValue(data.section.schoolYear)} ·
            Adviser {fieldValue(data.section.adviserName)}
          </p>
          {data.periods.length === 0 ? (
            <p className="help-text">This school year has no grading periods yet.</p>
          ) : (
            <Tabs
              key={data.section.id}
              defaultTab={defaultTab}
              tabs={data.periods.map((p) => ({ key: String(p.periodId), label: p.periodName, content: <PeriodTable period={p} /> }))}
            />
          )}
        </>
      )}
    </div>
  )
}
