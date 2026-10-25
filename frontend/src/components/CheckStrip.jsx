import { Check, AlertTriangle } from 'lucide-react'

// The four checks the risk formula makes, as four tiles — the answer to
// "how bad is it?" before a single sentence is read.
//
// All four are always shown, flagged or not. A list of only the problems
// cannot tell a student whether they are flagged on four things out of four
// or four out of twenty, and the cleared ones are the evidence that the
// rest of the formula looked at them and found nothing wrong.
//
// Shape and colour both carry the verdict (a warning triangle vs a check),
// and the word itself is there for screen readers, so colour alone never
// decides the meaning. `checks` comes straight from the server, which
// derives the rules from backend/config/riskConfig.js.
export function CheckStrip({ checks }) {
  if (!checks || checks.length === 0) return null

  return (
    <ul className="check-strip">
      {checks.map((check) => (
        <li key={check.factorKey} className={check.triggered ? 'is-flagged' : 'is-clear'} title={check.rule}>
          <span className="check-strip__icon">
            {check.triggered ? (
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Check size={14} strokeWidth={2} aria-hidden="true" />
            )}
          </span>
          <span className="check-strip__body">
            <span className="check-strip__measure">{check.measure}</span>
            <span className="check-strip__value">
              <span className="sr-only">{check.triggered ? 'Flagged. ' : 'Not flagged. '}</span>
              {check.currentText}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
