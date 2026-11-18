import { useEffect, useMemo, useState } from 'react'
import { Users, Layers, UserRound } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { StatCard, StatRow } from '../components/StatCard'
import { StatDetail } from '../components/StatDetail'
import { useStatExplainer } from '../hooks/useStatExplainer'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { TableToolbar, TableFilter } from '../components/table/TableToolbar'
import { StatusPill } from '../components/StatusPill'
import { ReportExportButtons } from '../components/reports/ReportExportButtons'
import { humanize } from '../utils/humanize'

// Enrolled Student List — the panel's report for the registrar (and the
// admin): this school year's learners placed in a section, filterable by
// grade level, section and strand, with the total and a count per section.
// GET /api/reports/enrolled-students (reportController.enrolledStudents).

const PAGE_SIZE = 15
const SEX = { M: 'Male', F: 'Female' }
const STATUS_VARIANTS = { enrolled: 'positive', pending: 'warning', dropped: 'negative', transferred: 'neutral', graduated: 'info' }

function statDetails(data) {
  return {
    total: {
      title: 'Learners',
      subtitle: data.total,
      definition: `Active learners placed in a section of school year ${data.schoolYear || 'this year'}, matching the filters.`,
      rules: [
        'By default only learners whose enrollment status is Enrolled are counted; the Status filter widens it.',
        'A deactivated learner, or one not yet given a section, is not counted.',
      ],
    },
    sections: {
      title: 'Sections',
      subtitle: data.bySection.length,
      definition: 'Sections in view, with how many learners each has.',
      breakdown: data.bySection.map((s) => ({ label: `Grade ${s.gradeLevel} – ${s.sectionName}`, value: s.count })),
    },
    sex: {
      title: 'Male / Female',
      subtitle: `${data.bySex.M} / ${data.bySex.F}`,
      definition: 'Learners in view by sex, as recorded on the student record.',
      breakdown: [
        { label: 'Male', value: data.bySex.M },
        { label: 'Female', value: data.bySex.F },
        { label: 'Not recorded', value: data.bySex.unrecorded },
      ],
    },
  }
}

export function EnrolledStudentsReportPage() {
  const [gradeLevel, setGradeLevel] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [strand, setStrand] = useState('')
  // An ENROLLED list by default; the registrar can widen it.
  const [status, setStatus] = useState('enrolled')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState(null)
  const { openFor, close, cardProps } = useStatExplainer('enrolled-stat-detail')

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (gradeLevel) params.set('gradeLevel', gradeLevel)
    if (sectionId) params.set('sectionId', sectionId)
    if (strand) params.set('strand', strand)
    if (status !== 'enrolled') params.set('status', status)
    return params.toString()
  }, [gradeLevel, sectionId, strand, status])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get(`/reports/enrolled-students${query ? `?${query}` : ''}`)
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
  }, [query])

  const options = data?.options
  // Narrow the section picker to the chosen grade level and strand.
  const sectionChoices = (options?.sections || []).filter(
    (s) => (!gradeLevel || String(s.gradeLevel) === gradeLevel) && (!strand || s.strand === strand)
  )
  const isFiltered = Boolean(gradeLevel || sectionId || strand || status !== 'enrolled')
  const rows = data ? data.students.map((s, i) => ({ ...s, index: i + 1 })) : []
  const details = data ? statDetails(data) : {}
  const change = (setter) => (e) => {
    setPage(1)
    setter(e.target.value)
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Reports' }, { label: 'Enrolled Students' }]} />
      <div className="page-header">
        <h1>Enrolled Student List</h1>
      </div>
      <p className="help-text mb-3">
        This school year{data?.schoolYear ? ` (${data.schoolYear})` : ''}: every active learner placed in a section whose
        enrollment status is Enrolled. Use Status to include dropped, transferred or other learners.
      </p>

      {error && <Alert>{error}</Alert>}
      {exportError && <Alert>{exportError}</Alert>}

      {data && (
        <>
          <StatRow>
            <StatCard icon={Users} value={data.total} label="Learners" {...cardProps('total')} />
            <StatCard icon={Layers} value={data.bySection.length} label="Sections" {...cardProps('sections')} />
            <StatCard icon={UserRound} value={`${data.bySex.M} / ${data.bySex.F}`} label="Male / Female" {...cardProps('sex')} />
          </StatRow>
          <StatDetail id="enrolled-stat-detail" detail={details[openFor()]} onClose={close} />
        </>
      )}

      <TableToolbar
        isFiltered={isFiltered}
        onClearFilters={() => {
          setGradeLevel('')
          setSectionId('')
          setStrand('')
          setStatus('enrolled')
          setPage(1)
        }}
        filters={
          <>
            <TableFilter label="Grade level">
              <select value={gradeLevel} onChange={change((v) => { setGradeLevel(v); setSectionId('') })}>
                <option value="">All</option>
                {(options?.gradeLevels || []).map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>
            </TableFilter>
            <TableFilter label="Strand">
              <select value={strand} onChange={change((v) => { setStrand(v); setSectionId('') })}>
                <option value="">All</option>
                {(options?.strands || []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </TableFilter>
            <TableFilter label="Status">
              <select value={status} onChange={change(setStatus)}>
                <option value="enrolled">Enrolled</option>
                <option value="all">All statuses</option>
                {['pending', 'dropped', 'transferred', 'graduated'].map((st) => (
                  <option key={st} value={st}>
                    {humanize(st)}
                  </option>
                ))}
              </select>
            </TableFilter>
            <TableFilter label="Section">
              <select value={sectionId} onChange={change(setSectionId)}>
                <option value="">All sections</option>
                {sectionChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    Grade {s.gradeLevel} – {s.name}
                  </option>
                ))}
              </select>
            </TableFilter>
          </>
        }
        actions={<ReportExportButtons path={`/reports/enrolled-students${query ? `?${query}` : ''}`} disabled={!data} onError={setExportError} />}
      />

      {data && data.bySection.length > 0 && (
        <p className="help-text mb-3">
          {data.bySection.map((s) => `Grade ${s.gradeLevel} – ${s.sectionName}: ${s.count}`).join(' · ')}
        </p>
      )}

      <DataTable
        columns={[
          { key: 'n', header: '#', render: (r) => r.index },
          { key: 'lrn', header: 'LRN', render: (r) => r.lrn },
          { key: 'name', header: 'Learner', primary: true, plainText: (r) => r.name, render: (r) => <span className="cell-primary">{r.name}</span> },
          { key: 'sex', header: 'Sex', render: (r) => fieldValue(SEX[r.sex]) },
          { key: 'section', header: 'Grade & section', render: (r) => `Grade ${r.gradeLevel} – ${r.sectionName}` },
          { key: 'strand', header: 'Strand', render: (r) => fieldValue(r.strand) },
          { key: 'adviser', header: 'Adviser', render: (r) => fieldValue(r.adviserName) },
          { key: 'subjects', header: 'Subjects', align: 'center', render: (r) => r.subjectCount },
          {
            key: 'status',
            header: 'Status',
            uniformValue: (r) => r.enrollmentStatus,
            render: (r) => <StatusPill label={humanize(r.enrollmentStatus)} variant={STATUS_VARIANTS[r.enrollmentStatus]} />,
          },
        ]}
        rows={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        rowKey={(r) => r.id}
        loading={loading && !data}
        refreshing={loading && Boolean(data)}
        error={error}
        isFiltered={isFiltered}
        page={page}
        pageSize={PAGE_SIZE}
        total={rows.length}
        onPageChange={setPage}
        emptyState={<p>No learner is placed in a section this school year yet.</p>}
        noResultsState={<p>No learner matches these filters.</p>}
      />
    </div>
  )
}
