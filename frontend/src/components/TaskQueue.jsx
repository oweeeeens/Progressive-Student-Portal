import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  CalendarCheck,
  PenLine,
  RotateCcw,
  ShieldCheck,
  HeartHandshake,
  Clock,
  UserPlus,
  KeyRound,
  ChevronRight,
  Check,
} from 'lucide-react'
import './TaskQueue.css'

// "What needs you today" — the home page's lead content.
//
// WHY A LIST AND NOT A ROW OF CARDS
//
// The dashboard already has a row of stat cards, and a second row of
// identically-shaped cards underneath it was most of what made this page
// read as generated: three bands of white rectangles, nothing leading.
// These are tasks rather than figures, so they get the shape of a queue —
// one row each, read top to bottom in the order they should be dealt with.
// It also means each row has somewhere to put the sentence that says what
// its number actually counts, which a tile the size of a stat card does
// not.
//
// The server decides what is in here and in what order (see
// backend/models/dashboardQueueModel.js); this component decides nothing
// about scope or priority. It owns exactly two things: the icon per task
// and the English for the count.

// One icon per task key. Kept here rather than in the server's config
// because an icon is a React component, and backend/config/dashboardQueue.js
// has no business naming one.
const TASK_ICONS = {
  finalize_grades: CheckCircle2,
  mark_daily_attendance: CalendarCheck,
  submit_grades: PenLine,
  resubmit_rejected_grades: RotateCcw,
  verify_grades: ShieldCheck,
  flagged_without_support: HeartHandshake,
  stale_interventions: Clock,
  pending_student_accounts: UserPlus,
  temporary_passwords: KeyRound,
}

// "1 grade" / "4 grades" / "2 classes". The server sends the singular noun
// and nothing else, so a count can never be rendered as a bare "2 items" —
// knowing whether two sections or two learners are waiting is most of what
// makes the number useful.
function pluralise(unit, count) {
  if (count === 1) return unit
  return /(?:s|x|ch|sh)$/.test(unit) ? `${unit}es` : `${unit}s`
}

function TaskRow({ task }) {
  const Icon = TASK_ICONS[task.key] || CheckCircle2

  return (
    <li className={`task-row task-row--${task.area}${task.urgency === 'now' ? ' task-row--now' : ''}`}>
      <Link to={task.href} className="task-row__link">
        <span className="task-row__icon" aria-hidden="true">
          <Icon size={20} strokeWidth={1.75} />
        </span>

        <span className="task-row__body">
          <span className="task-row__title">{task.title}</span>
          {/* The sentence that keeps the number honest. Every word of it is
              checked against the query behind the count — see the server's
              config, where it lives beside the figure it describes. */}
          <span className="task-row__detail">{task.detail}</span>
        </span>

        <span className="task-row__count">
          {/* The figure and its unit are one phrase, not a big number with a
              caption: "4" alone on a task row is ambiguous in a way "4
              grades" never is. */}
          <span className="task-row__value">{task.count}</span>
          <span className="task-row__unit">{pluralise(task.unit, task.count)}</span>
        </span>

        <ChevronRight className="task-row__chevron" size={18} strokeWidth={2} aria-hidden="true" />
      </Link>
    </li>
  )
}

// `tasks`: the server's queue, already ordered. Rows counting zero are
// included deliberately — see below.
export function TaskQueue({ tasks, gradingPeriodName }) {
  // No queue AT ALL is different from an empty queue, and the difference
  // matters: a student, and anyone holding no advisory section and no
  // class, have nothing on this list by definition. Telling them they are
  // "all caught up" would be a claim about work they were never given.
  if (!tasks || tasks.length === 0) return null

  const outstanding = tasks.filter((task) => task.count > 0)
  const cleared = tasks.filter((task) => task.count === 0)

  return (
    <section className="task-queue" aria-labelledby="task-queue-heading">
      <div className="task-queue__head">
        <h2 id="task-queue-heading">What needs you today</h2>
        {gradingPeriodName && <span className="task-queue__period">{gradingPeriodName}</span>}
      </div>

      {outstanding.length === 0 ? (
        // A first-class state, not a blank space. Somebody who has cleared
        // their queue should be able to see that they have, and see what
        // was checked to decide it.
        <div className="task-queue__clear">
          <span className="task-queue__clear-icon" aria-hidden="true">
            <Check size={20} strokeWidth={2.25} />
          </span>
          <div>
            <p className="task-queue__clear-title">You are all caught up</p>
            <p className="task-queue__clear-detail">
              Nothing is waiting on you across {cleared.length} {cleared.length === 1 ? 'check' : 'checks'}:{' '}
              {cleared.map((task) => task.title.toLowerCase()).join(', ')}.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ul className="task-queue__list">
            {outstanding.map((task) => (
              <TaskRow key={task.key} task={task} />
            ))}
          </ul>

          {/* The cleared items stay visible as one quiet line rather than as
              rows reading "0". Their absence would be ambiguous — an adviser
              cannot tell "no grades to finalize" from "finalizing is not
              something this page checks". */}
          {cleared.length > 0 && (
            <p className="task-queue__cleared">
              <Check size={14} strokeWidth={2.25} aria-hidden="true" />
              Clear: {cleared.map((task) => task.title.toLowerCase()).join(', ')}.
            </p>
          )}
        </>
      )}
    </section>
  )
}
