import { ExplainerPanel } from './ExplainerPanel'

// Why each figure at the top of My Grades says what it says, in the same
// in-place form the home page's figures use (see StatExplainer).
//
// Everything here is recomputed from the marks the page is already showing,
// so a card and its explanation can never disagree. The marks in question
// are the finalized ones for a single grading period — the same set the
// Average grade figure on the home page is built from, which is why the two
// pages now report the same number instead of two defensible but different
// averages.

function round1(value) {
  return Math.round(value * 10) / 10
}

function CalcRow({ label, value, isTotal = false }) {
  return (
    <div className={`stat-explainer__row${isTotal ? ' is-total' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// Marks sorted the way each explanation wants to read them: highest first
// for a ranking, lowest first when the subject is what is going wrong.
function sortByGrade(marks, direction) {
  return [...marks].sort((a, b) => (direction === 'desc' ? b.grade - a.grade : a.grade - b.grade))
}

export function GradeStatExplainer({ statKey, periodName, marks, passingGrade, onClose, id }) {
  if (!marks || marks.length === 0) return null

  const total = marks.reduce((sum, m) => sum + m.grade, 0)
  const average = round1(total / marks.length)
  const below = marks.filter((m) => passingGrade != null && m.grade < passingGrade)

  if (statKey === 'average') {
    return (
      <ExplainerPanel id={id} title="Average" subtitle={`${periodName} · ${average}`} onClose={onClose}>
        <div className="stat-explainer__calc">
          {sortByGrade(marks, 'asc').map((m) => (
            <CalcRow key={m.subjectName} label={m.subjectName} value={m.grade} />
          ))}
          <CalcRow
            label={`${round1(total)} ÷ ${marks.length} ${marks.length === 1 ? 'subject' : 'subjects'}`}
            value={average}
            isTotal
          />
        </div>
        <p className="stat-explainer__rule">
          Your finalized marks in {periodName}, added up and divided by how many subjects they cover. A mark still in
          review is left out until your adviser enters it into the official record — which is why this can differ from
          what you were told in class.
        </p>
      </ExplainerPanel>
    )
  }

  if (statKey === 'belowPassing') {
    return (
      <ExplainerPanel
        id={id}
        title="Below the passing grade"
        subtitle={`${below.length} of ${marks.length}`}
        onClose={onClose}
      >
        {below.length === 0 ? (
          <p className="stat-explainer__lead">Every subject is at or above the passing grade of {passingGrade}.</p>
        ) : (
          <div className="stat-explainer__calc">
            {sortByGrade(below, 'asc').map((m) => (
              <CalcRow
                key={m.subjectName}
                label={m.subjectName}
                value={`${m.grade} · ${round1(passingGrade - m.grade)} short`}
              />
            ))}
          </div>
        )}
        <p className="stat-explainer__rule">
          Counted from your finalized marks in {periodName}. {passingGrade} is the passing grade the school uses, and
          each subject is counted on its own — one subject below it does not pull the others down.
        </p>
      </ExplainerPanel>
    )
  }

  // Highest and lowest share one explanation: a ranking only means anything
  // next to the subjects it was drawn from.
  const ranked = sortByGrade(marks, 'desc')
  const isHighest = statKey === 'highest'
  const subject = isHighest ? ranked[0] : ranked[ranked.length - 1]

  return (
    <ExplainerPanel
      id={id}
      title={isHighest ? 'Highest mark' : 'Lowest mark'}
      subtitle={`${subject.subjectName} · ${subject.grade}`}
      onClose={onClose}
    >
      <div className="stat-explainer__calc">
        {ranked.map((m) => (
          <CalcRow
            key={m.subjectName}
            label={m.subjectName}
            value={m.grade}
            isTotal={m.subjectName === subject.subjectName}
          />
        ))}
      </div>
      <p className="stat-explainer__rule">
        All your finalized marks in {periodName}, highest first.
        {passingGrade != null &&
          (subject.grade < passingGrade
            ? ` ${subject.subjectName} is ${round1(passingGrade - subject.grade)} points below the passing grade of ${passingGrade}.`
            : ` ${subject.subjectName} is ${round1(subject.grade - passingGrade)} points clear of the passing grade of ${passingGrade}.`)}
      </p>
    </ExplainerPanel>
  )
}
