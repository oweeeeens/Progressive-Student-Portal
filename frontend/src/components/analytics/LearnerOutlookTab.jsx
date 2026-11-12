import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, LifeBuoy, AlertOctagon, Siren, CalendarX } from 'lucide-react'
import { api } from '../../api/client'
import { StatCard, StatRow } from '../StatCard'
import { StatDetail } from '../StatDetail'
import { useStatExplainer } from '../../hooks/useStatExplainer'
import { BarChart } from '../charts/BarChart'
import { ChartCard, ChartCardRow } from '../charts/ChartCard'
import { DataTable } from '../table/DataTable'
import { StatusPill } from '../StatusPill'
import { Alert } from '../Alert'
import { SkeletonChart, SkeletonTable } from '../Skeleton'

// Analytics' "Learner Outlook" tab — who is at risk of FAILING, in what, and
// why. The other tabs describe the risk score; this one answers the
// questions an adviser and the principal act on, each tied to the DepEd
// Order No. 015, s. 2026 paragraph it implements:
//
//   Promotion outlook (¶67)   on track / summer remedial / retention risk
//   Subjects causing failure  which subjects learners are below 75 in
//   Where points are lost (¶68) WW vs PT vs exams, per subject
//   Early warning (¶68)       provisional grades from the class record,
//                             before anything is final — flagged in-term,
//                             when remediation can still change the outcome
//   Absence alert (¶70)       learners at or near twelve absences
//
// Fed by one request (GET /analytics/learner-outlook) under the page's own
// filters, and scoped on the server: an adviser sees only their sections.

const CATEGORY_LABELS = { on_track: 'On track', summer_remedial: 'Summer remedial', retention_risk: 'Retention risk' }
const CATEGORY_VARIANTS = { on_track: 'positive', summer_remedial: 'warning', retention_risk: 'negative' }
const COMPONENT_SHORT = { ww: 'Written Works', pt: 'Performance Tasks', ex: 'Exams' }
const COMPONENT_COLORS = { ww: 'var(--chart-blue)', pt: 'var(--module-attendance)', ex: 'var(--module-grades)' }

function outlookDetails(data) {
  const t = data.thresholds
  const p = data.promotion.counts
  return {
    on_track: {
      title: 'On track',
      subtitle: p.on_track,
      definition: `Learners with no subject below ${t.PASSING_GRADE} so far this year.`,
      rules: [
        "A subject's grade so far is the average of its finalized term grades, rounded — with all three terms in, it is the final grade.",
        'Only finalized grades count, the same official record the risk score reads.',
      ],
      footnote: 'DepEd Order No. 015, s. 2026, ¶67: a learner who passes every learning area is promoted.',
    },
    summer_remedial: {
      title: 'Summer remedial',
      subtitle: p.summer_remedial,
      definition: `Learners below ${t.PASSING_GRADE} in 1 to ${t.PROMOTION_FAIL_LIMIT} subjects so far.`,
      rules: ['If the year ended now, these learners would attend Summer Remedial Class. There is still time to change that.'],
      footnote: 'DO 015 ¶67(b): learners who fail in at most two learning areas undergo Summer Remedial Class.',
    },
    retention_risk: {
      title: 'Retention risk',
      subtitle: p.retention_risk,
      definition: `Learners below ${t.PASSING_GRADE} in more than ${t.PROMOTION_FAIL_LIMIT} subjects so far.`,
      rules: ['If the year ended now, these learners would be retained in the same grade level.'],
      footnote: 'DO 015 ¶67(e): learners who fail in more than two learning areas are retained.',
    },
    early: {
      title: 'Early warning',
      subtitle: data.earlyWarning.learnersBelowPassing,
      definition: `Learners whose PROVISIONAL term grade in ${data.periodName}, computed from the scores already in the class record, is below ${t.PASSING_GRADE} in at least one subject.`,
      rules: [
        'Provisional: these grades are not submitted or finalized yet, and they do not change the official risk score.',
        `${data.earlyWarning.learnersMissingWork} learner(s) also have scores still missing.`,
      ],
      footnote: 'DO 015 ¶68: teachers remediate within the term — as early as Week 5 after the first Summative Test.',
    },
    absences: {
      title: 'Absence alert',
      subtitle: data.absences.alert,
      definition: `Learners with ${t.ABSENCE_ALERT_DAYS} or more absences this school year in the daily (SF2) register (absent and excused).`,
      breakdown: [
        { label: `At or over ${t.ABSENCE_ALERT_DAYS}`, value: data.absences.alert },
        { label: `Approaching (${t.ABSENCE_APPROACHING_DAYS}–${t.ABSENCE_ALERT_DAYS - 1})`, value: data.absences.approaching },
      ],
      footnote: 'DO 015 ¶70: teachers intervene by the end of Term 1 or when a learner reaches approximately twelve absences.',
    },
  }
}

export function LearnerOutlookTab({ query }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const { openFor, close, cardProps } = useStatExplainer('outlook-stat-detail')

  useEffect(() => {
    setError(null)
    api
      .get(`/analytics/learner-outlook${query}`)
      .then(setData)
      .catch((err) => {
        setData(null)
        setError(err.message)
      })
  }, [query])

  if (error) return <Alert>Couldn&apos;t load the learner outlook: {error}</Alert>
  if (!data) {
    return (
      <>
        <SkeletonChart />
        <SkeletonTable rows={5} columns={4} />
      </>
    )
  }

  const p = data.promotion
  const details = outlookDetails(data)
  const failingSubjects = data.subjects.filter((s) => s.failing > 0)
  const maxFailing = Math.max(1, ...failingSubjects.map((s) => s.failing))

  return (
    <div>
      <p className="help-text mb-3">
        Who is at risk of failing, in what, and why — under the filters above. Built from finalized grades, the class
        record ({data.periodName}) and the daily attendance register, following DepEd Order No. 015, s. 2026.
      </p>

      <StatRow>
        <StatCard icon={CheckCircle2} value={p.counts.on_track} label="On track" variant="positive" {...cardProps('on_track')} />
        <StatCard icon={LifeBuoy} value={p.counts.summer_remedial} label="Summer remedial" variant="warning" {...cardProps('summer_remedial')} />
        <StatCard icon={AlertOctagon} value={p.counts.retention_risk} label="Retention risk" variant="negative" {...cardProps('retention_risk')} />
        <StatCard icon={Siren} value={data.earlyWarning.learnersBelowPassing} label="Early warning" variant="warning" {...cardProps('early')} />
        <StatCard icon={CalendarX} value={data.absences.alert} label="Absence alerts" variant="negative" {...cardProps('absences')} />
      </StatRow>
      <StatDetail id="outlook-stat-detail" detail={details[openFor()]} onClose={close} />

      {/* 1. Promotion outlook */}
      <div className="record-section">
        <h2>Promotion Outlook</h2>
        <p className="help-text">
          If the school year ended today, by DepEd&apos;s promotion rule (DO 015 ¶67). Learners who are not on track are listed
          first, with the subjects they are below {data.thresholds.PASSING_GRADE} in.
        </p>
        <DataTable
          columns={[
            { key: 'name', header: 'Learner', primary: true, plainText: (l) => l.name, render: (l) => <Link to={`/students/${l.studentId}`}>{l.name}</Link> },
            { key: 'section', header: 'Section', render: (l) => `Grade ${l.gradeLevel} - ${l.sectionName}` },
            { key: 'outlook', header: 'Outlook', render: (l) => <StatusPill label={CATEGORY_LABELS[l.category]} variant={CATEGORY_VARIANTS[l.category]} /> },
            {
              key: 'failing',
              header: `Below ${data.thresholds.PASSING_GRADE}`,
              plainText: (l) => l.failing.map((f) => `${f.subjectName} ${f.grade}`).join(', '),
              render: (l) => (l.failing.length === 0 ? <span className="text-muted">—</span> : <span className="outlook-wrap">{l.failing.map((f) => `${f.subjectName} (${f.grade})`).join(', ')}</span>),
            },
          ]}
          rows={p.learners.filter((l) => l.category !== 'on_track')}
          rowKey={(l) => l.studentId}
          emptyState={
            <>
              <p>{p.total === 0 ? 'No finalized grades yet in this view.' : 'Every learner in this view is on track.'}</p>
              <p>{p.total === 0 ? 'The outlook appears once grades are finalized.' : `${p.counts.on_track} learner(s) have no subject below ${data.thresholds.PASSING_GRADE}.`}</p>
            </>
          }
        />
      </div>

      {/* 2. Subjects causing failure */}
      <div className="record-section">
        <h2>Subjects Causing Failure</h2>
        <ChartCard
          title="Learners below 75, by subject"
          description="Finalized grades so far this year, per class."
          legend={[{ label: 'Learners below 75', color: 'var(--band-at-risk-medium)' }]}
          isEmpty={failingSubjects.length === 0}
          emptyMessage="No learner is below 75 in any subject in this view."
          interpretation={
            failingSubjects.length > 0
              ? `${failingSubjects[0].subjectName} (Grade ${failingSubjects[0].gradeLevel} ${failingSubjects[0].sectionName}) has the most learners below 75: ${failingSubjects[0].failing} of ${failingSubjects[0].learners}.`
              : undefined
          }
        >
          <BarChart
            rows={failingSubjects.slice(0, 10).map((s) => ({
              key: s.classOfferingId,
              label: `${s.subjectName} · ${s.sectionName}`,
              value: s.failing,
              valueText: `${s.failing} of ${s.learners} (${s.failingShare}%) · avg ${s.average}`,
              color: 'var(--band-at-risk-medium)',
            }))}
            maxValue={maxFailing}
          />
        </ChartCard>
      </div>

      {/* 3. Where learners lose points */}
      <div className="record-section">
        <h2>Where Learners Lose Points — {data.periodName}</h2>
        <p className="help-text">
          The class average in each component, from the class record. The weakest component is where remediation helps most
          (DO 015 ¶68). A component below {data.thresholds.COMPONENT_STRUGGLE_PERCENT}% would not pass on its own.
        </p>
        {data.components.length === 0 ? (
          <p className="help-text">No class record scores for {data.periodName} in this view yet.</p>
        ) : (
          <ChartCardRow>
            {data.components.slice(0, 6).map((c) => (
              <ChartCard
                key={c.classOfferingId}
                title={`${c.subjectName} · ${c.sectionName}`}
                legend={c.components.map((x) => ({ label: COMPONENT_SHORT[x.key], color: COMPONENT_COLORS[x.key] }))}
                interpretation={`Weakest: ${COMPONENT_SHORT[c.weakest]} at ${c.weakestAverage}%.`}
              >
                <BarChart
                  rows={c.components.map((x) => ({
                    key: x.key,
                    label: COMPONENT_SHORT[x.key],
                    value: x.average,
                    valueText: `${x.average}% · ${x.struggling} below ${data.thresholds.COMPONENT_STRUGGLE_PERCENT}%`,
                    color: COMPONENT_COLORS[x.key],
                  }))}
                  maxValue={100}
                />
              </ChartCard>
            ))}
          </ChartCardRow>
        )}
      </div>

      {/* 4. Early warning */}
      <div className="record-section">
        <h2>Early Warning — {data.periodName}, before grades are final</h2>
        <Alert variant="info">
          Provisional grades computed from the scores already recorded. They are not submitted or finalized and do not change
          the official risk score — they show who to help while the term can still be turned around.
        </Alert>
        <DataTable
          columns={[
            { key: 'name', header: 'Learner', primary: true, plainText: (r) => r.name, render: (r) => <Link to={`/students/${r.studentId}`}>{r.name}</Link> },
            { key: 'section', header: 'Section', render: (r) => r.sectionName },
            { key: 'subject', header: 'Subject', render: (r) => r.subjectName },
            { key: 'grade', header: 'Provisional grade', align: 'right', render: (r) => r.provisionalGrade },
          ]}
          rows={data.earlyWarning.belowPassing}
          rowKey={(r) => `${r.studentId}-${r.classOfferingId}`}
          emptyState={<p>No learner&apos;s provisional grade is below {data.thresholds.PASSING_GRADE} in this view.</p>}
        />
        {data.earlyWarning.missingWork.length > 0 && (
          <>
            <h3 className="mt-4">Scores still missing</h3>
            <DataTable
              columns={[
                { key: 'name', header: 'Learner', primary: true, plainText: (r) => r.name, render: (r) => <Link to={`/students/${r.studentId}`}>{r.name}</Link> },
                { key: 'subject', header: 'Subject', render: (r) => `${r.subjectName} · ${r.sectionName}` },
                { key: 'missing', header: 'Missing', plainText: (r) => r.missing.join(', '), render: (r) => <span className="outlook-wrap">{`${r.missingCount}: ${r.missing.join(', ')}`}</span> },
              ]}
              rows={data.earlyWarning.missingWork}
              rowKey={(r) => `${r.studentId}-${r.classOfferingId}`}
            />
          </>
        )}
      </div>

      {/* 5. Absence alert */}
      <div className="record-section">
        <h2>Absence Alert</h2>
        <p className="help-text">
          DepEd expects an intervention when a learner reaches about {data.thresholds.ABSENCE_ALERT_DAYS} absences (DO 015 ¶70).
          Counts this school year&apos;s absent and excused days in the daily (SF2) register.
        </p>
        <DataTable
          columns={[
            { key: 'name', header: 'Learner', primary: true, plainText: (r) => r.name, render: (r) => <Link to={`/students/${r.studentId}`}>{r.name}</Link> },
            { key: 'section', header: 'Section', render: (r) => r.sectionName },
            { key: 'absences', header: 'Absences', align: 'right', render: (r) => `${r.absences} (${r.absent} absent, ${r.excused} excused)` },
            { key: 'rate', header: 'Attendance', align: 'right', render: (r) => (r.attendanceRate === null ? '—' : `${r.attendanceRate}%`) },
            { key: 'level', header: 'Level', render: (r) => <StatusPill label={r.level === 'alert' ? 'Alert' : 'Approaching'} variant={r.level === 'alert' ? 'negative' : 'warning'} /> },
          ]}
          rows={data.absences.learners}
          rowKey={(r) => r.studentId}
          emptyState={<p>No learner is at or near {data.thresholds.ABSENCE_ALERT_DAYS} absences in this view.</p>}
        />
      </div>
    </div>
  )
}
