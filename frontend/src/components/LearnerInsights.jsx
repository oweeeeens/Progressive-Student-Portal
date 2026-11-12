import { useEffect, useState } from 'react'
import { CheckCircle2, LifeBuoy, AlertOctagon, BookOpen, Target, Siren, CalendarX } from 'lucide-react'
import { api } from '../api/client'
import { StatCard, StatRow } from './StatCard'
import { BarChart } from './charts/BarChart'
import { ChartCard, ChartCardRow } from './charts/ChartCard'
import { Alert } from './Alert'
import { StatusPill } from './StatusPill'
import { SkeletonChart } from './Skeleton'

// Analytics for ONE learner — the Learner Outlook views applied to this
// learner alone (DepEd Order No. 015, s. 2026, ¶67/¶68/¶70). Shown as the
// "Learner Insights" tab on a learner's record (staff) and as "How you're
// doing" on the learner's own My Progress (`audience="learner"`, wording
// addressed to them). Data: GET /students/:id/insights, scoped exactly like
// the learner's record.

const OUTLOOK = {
  on_track: { label: 'On track', variant: 'positive', icon: CheckCircle2 },
  summer_remedial: { label: 'Summer remedial', variant: 'warning', icon: LifeBuoy },
  retention_risk: { label: 'Retention risk', variant: 'negative', icon: AlertOctagon },
}
const COMPONENT_SHORT = { ww: 'Written Works', pt: 'Performance Tasks', ex: 'Exams' }
const COMPONENT_COLORS = { ww: 'var(--chart-blue)', pt: 'var(--module-attendance)', ex: 'var(--module-grades)' }

export function LearnerInsights({ studentId, audience = 'staff' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const you = audience === 'learner'

  useEffect(() => {
    setData(null)
    setError(null)
    api
      .get(`/students/${studentId}/insights`)
      .then(setData)
      .catch((err) => setError(err.message))
  }, [studentId])

  if (error) return <Alert>Couldn&apos;t load the insights: {error}</Alert>
  if (!data) return <SkeletonChart />
  if (data.empty) return <p className="help-text">No school year is set up for this learner yet.</p>

  const t = data.thresholds
  const outlook = data.promotion ? OUTLOOK[data.promotion.category] : null
  const below = data.standing.filter((s) => s.grade < t.PASSING_GRADE)
  const sortedComponents = [...data.overallComponents].sort((a, b) => a.average - b.average)
  const weakest = sortedComponents[0]
  const strongest = sortedComponents[sortedComponents.length - 1]
  const a = data.attendance

  return (
    <div className="learner-insights">
      <StatRow>
        <StatCard
          icon={outlook ? outlook.icon : CheckCircle2}
          value={outlook ? outlook.label : '—'}
          label={you ? 'Your outlook so far' : 'Promotion outlook'}
          variant={outlook ? outlook.variant : undefined}
        />
        <StatCard icon={BookOpen} value={below.length} label={`Subjects below ${t.PASSING_GRADE}`} variant={below.length > 0 ? 'negative' : 'positive'} />
        <StatCard icon={Target} value={weakest ? COMPONENT_SHORT[weakest.key] : '—'} label="Weakest component" variant={weakest && weakest.average < t.COMPONENT_STRUGGLE_PERCENT ? 'warning' : undefined} />
        <StatCard icon={Siren} value={data.provisional.belowPassing.length} label="Provisional, this term" variant={data.provisional.belowPassing.length > 0 ? 'warning' : undefined} />
        <StatCard icon={CalendarX} value={`${a.absences} / ${t.ABSENCE_ALERT_DAYS}`} label="Absences this year" variant={a.level === 'alert' ? 'negative' : a.level === 'approaching' ? 'warning' : undefined} />
      </StatRow>

      {/* The outlook, said as a sentence — the one line to read first. */}
      {data.promotion ? (
        <p className="learner-insights__lead">
          {data.promotion.category === 'on_track'
            ? `${you ? 'You have' : 'No subject is'} ${you ? `no subject below ${t.PASSING_GRADE}` : `below ${t.PASSING_GRADE}`} so far this year — on track for promotion.`
            : `If the school year ended today, ${you ? 'you' : 'this learner'} would ${data.promotion.category === 'summer_remedial' ? 'attend Summer Remedial Class' : 'be retained in the same grade level'}: below ${t.PASSING_GRADE} in ${data.promotion.failing
                .map((f) => `${f.subjectName} (${f.grade})`)
                .join(', ')}. There is still time to change this.`}{' '}
          <span className="text-muted">DepEd Order No. 015, s. 2026, ¶67.</span>
        </p>
      ) : (
        <p className="learner-insights__lead text-muted">No finalized grades yet this year, so there is no outlook to show.</p>
      )}

      <ChartCardRow>
        <ChartCard
          title={you ? 'Your subjects so far' : 'Subject standing'}
          description="Average of each subject's finalized term grades this year."
          legend={[
            { label: `Below ${t.PASSING_GRADE}`, color: 'var(--band-at-risk-medium)' },
            { label: `${t.PASSING_GRADE} or above`, color: 'var(--chart-blue)' },
          ]}
          isEmpty={data.standing.length === 0}
          emptyMessage="No finalized grades yet this year."
          interpretation={
            data.standing.length > 0 ? `Lowest: ${data.standing[0].subjectName} at ${data.standing[0].grade}.` : undefined
          }
        >
          <BarChart
            rows={data.standing.map((s) => ({
              key: s.classOfferingId,
              label: s.subjectName,
              value: s.grade,
              valueText: `${s.grade}${s.terms.length > 1 ? ` (${s.terms.map((x) => x.grade).join(' → ')})` : ''}`,
              color: s.grade < t.PASSING_GRADE ? 'var(--band-at-risk-medium)' : 'var(--chart-blue)',
            }))}
            maxValue={100}
          />
        </ChartCard>

        <ChartCard
          title={you ? 'Where you earn and lose points' : 'Strengths and weaknesses'}
          description={`Average percentage per component across subjects, ${data.periodName || 'this term'} (class record).`}
          legend={data.overallComponents.map((c) => ({ label: COMPONENT_SHORT[c.key], color: COMPONENT_COLORS[c.key] }))}
          isEmpty={data.overallComponents.length === 0}
          emptyMessage="No class record scores for this term yet."
          interpretation={
            weakest && strongest && weakest.key !== strongest.key
              ? `Strongest in ${COMPONENT_SHORT[strongest.key]} (${strongest.average}%); weakest in ${COMPONENT_SHORT[weakest.key]} (${weakest.average}%) — ${
                  you ? 'that is where extra practice will help most.' : 'that is where support helps most (DO 015 ¶68).'
                }`
              : undefined
          }
        >
          <BarChart
            rows={data.overallComponents.map((c) => ({
              key: c.key,
              label: COMPONENT_SHORT[c.key],
              value: c.average,
              valueText: `${c.average}%`,
              color: COMPONENT_COLORS[c.key],
            }))}
            maxValue={100}
          />
        </ChartCard>
      </ChartCardRow>

      <div className="learner-insights__grid">
        <section className="panel">
          <h3>{data.periodName || 'This term'} so far (provisional)</h3>
          <p className="help-text">
            Computed from the scores already recorded. Not submitted or final yet — it shows where the term is heading.
          </p>
          {data.provisional.belowPassing.length === 0 && data.provisional.missingWork.length === 0 ? (
            <p>Nothing below {t.PASSING_GRADE} and no missing scores this term.</p>
          ) : (
            <ul className="learner-insights__list">
              {data.provisional.belowPassing.map((r) => (
                <li key={`b-${r.classOfferingId}`}>
                  <StatusPill label={`${r.provisionalGrade}`} variant="warning" /> {r.subjectName} — provisional grade below {t.PASSING_GRADE}
                </li>
              ))}
              {data.provisional.missingWork.map((r) => (
                <li key={`m-${r.classOfferingId}`}>
                  <StatusPill label={`${r.missingCount} missing`} variant="neutral" /> {r.subjectName}: {r.missing.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h3>Attendance this year</h3>
          <div className="learner-insights__meter" role="img" aria-label={`${a.absences} of ${t.ABSENCE_ALERT_DAYS} absences`}>
            <span
              className={`learner-insights__meter-fill is-${a.level}`}
              style={{ width: `${Math.min(100, (a.absences / t.ABSENCE_ALERT_DAYS) * 100)}%` }}
            />
          </div>
          <p>
            {a.absences} absence{a.absences === 1 ? '' : 's'} ({a.absent} absent, {a.excused} excused)
            {a.attendanceRate !== null ? ` · ${a.attendanceRate}% attendance over ${a.recordedDays} recorded days` : ''}.
          </p>
          <p className="help-text">
            {a.level === 'alert'
              ? `At or past ${t.ABSENCE_ALERT_DAYS} absences — DepEd expects the adviser and the family to act now (DO 015 ¶70).`
              : `${a.untilAlert} more before the ${t.ABSENCE_ALERT_DAYS}-absence mark, when DepEd expects an intervention (DO 015 ¶70).`}
          </p>
        </section>
      </div>
    </div>
  )
}
