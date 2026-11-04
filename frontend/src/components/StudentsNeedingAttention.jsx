import { Link } from 'react-router-dom'
import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { StatusPill } from './StatusPill'
import { Skeleton } from './Skeleton'
import './StudentsNeedingAttention.css'

const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }

// The learners most worth a conversation this week.
//
// This is the point of the whole system, and until now it was a 300px
// column of 12px text in a right-hand sidebar, under the announcements.
// It has been promoted beside the band chart and given rows a person can
// actually read: the learner's name at body size, the band they are in as
// a labelled pill, and the single factor that put them there.
//
// PRESENTATIONAL ONLY. It used to fetch its own list, which meant the page
// around it could not know whether this block would appear — so the layout
// had to reserve a column for something that might render nothing. The page
// fetches now and decides the layout from what came back.
//
// `students`: null while loading, then the server's list (already limited
// and already scoped — see backend/models/dashboardModel.js's
// getTopAtRiskStudents, which counts only Medium and High and only within
// the sections this person advises).
export function StudentsNeedingAttention({ students }) {
  return (
    <aside className="panel attention-widget" aria-labelledby="attention-heading">
      <div className="attention-widget__head">
        <h2 id="attention-heading">Needs a conversation</h2>
        <Link to="/academic-progress" className="attention-widget__all">
          See all
          <ArrowUpRight size={14} strokeWidth={2} />
        </Link>
      </div>

      {!students ? (
        <div aria-hidden="true" className="attention-widget__list">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h="3.25rem" radius="var(--radius-md)" />
          ))}
        </div>
      ) : students.length === 0 ? (
        // A real answer, not a blank. "Nobody is flagged" is the result the
        // school is working towards, so it is worth stating — and stating
        // what was checked, since the same page carries an at-risk count
        // that excludes Low risk and could otherwise look inconsistent.
        <div className="attention-widget__clear">
          <ShieldCheck size={20} strokeWidth={1.75} aria-hidden="true" />
          <p>No learner in your scope came out Medium or High risk this grading period.</p>
        </div>
      ) : (
        <ul className="attention-widget__list">
          {students.map((student) => (
            <li key={student.studentId}>
              <Link
                to={`/students/${student.studentId}`}
                className={`attention-widget__item attention-widget__item--${student.riskLevel}`}
              >
                <span className="attention-widget__row">
                  <span className="attention-widget__name">
                    {student.lastName}, {student.firstName}
                  </span>
                  {/* The band as text as well as colour. The risk ramp is one
                      hue deepening with severity, which is deliberate and
                      colour-vision-validated, but it is never the only
                      signal (CLAUDE.md). */}
                  <StatusPill label={student.riskLevel} variant={RISK_VARIANTS[student.riskLevel]} />
                </span>
                {/* Why they are here. Without it the row is a name and a
                    colour, and an adviser has to open the record to find out
                    whether this is about grades or absences. */}
                {student.primaryFactor && <span className="attention-widget__factor">{student.primaryFactor}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
