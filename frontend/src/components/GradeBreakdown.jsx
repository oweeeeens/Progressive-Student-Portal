import { useCallback, useState } from 'react'
import { Modal } from './Modal'
import { DEPED_SOURCE } from '../utils/gradingPolicy'

// How a term grade was computed, written out as arithmetic.
//
// WHY. The research adviser's objection to the old Enter Grades page was
// that a grade typed into a box cannot be checked: nobody reading it can see
// where it came from. Every grade is now computed from recorded scores
// (DepEd Order No. 015, s. 2026, Annex D), and this is where that
// computation is shown — to the principal before verifying, the adviser
// before finalizing, staff on a learner's record, and the learner on My
// Grades. Same reasoning as StatExplainer: a figure a person is entitled to
// question should show its working.
//
// It renders the SNAPSHOT stored with the grade (grades.computation), not a
// fresh recomputation, so it always shows exactly what the grade on record
// was computed from — even if a score was corrected afterwards.

const fmt = (value) => (value === null || value === undefined ? '—' : Number(value).toFixed(2))
const pct = (fraction) => `${Math.round(fraction * 100)}%`
const num = (value) => (Number.isInteger(Number(value)) ? String(Number(value)) : Number(value).toFixed(2))

function Row({ label, value, total = false }) {
  return (
    <div className={`stat-explainer__row${total ? ' is-total' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

// The score on each item, compactly: "Quiz 1 17/20 · Quiz 2 22/25".
function ItemList({ items }) {
  if (!items || items.length === 0) return null
  return (
    <p className="grade-breakdown__items">
      {items.map((item) => `${item.title} ${item.rawScore === null ? '—' : num(item.rawScore)}/${num(item.highestPossibleScore)}`).join(' · ')}
    </p>
  )
}

export function GradeBreakdown({ computation, gradeValue }) {
  if (!computation) {
    return (
      <p className="help-text">
        This grade was recorded before the Class Record existed, so there are no scores on file to show how it was
        computed.
      </p>
    )
  }
  const { components, initialGrade, termGrade, mode } = computation
  return (
    <div className="grade-breakdown">
      {components.map((c) => (
        <section key={c.key} className="grade-breakdown__component">
          <h4>
            {c.label} <span className="text-muted">· {pct(c.weight)} of the grade</span>
          </h4>
          {c.key !== 'ex' ? (
            <>
              <ItemList items={c.items} />
              <div className="stat-explainer__calc">
                <Row label="Total score ÷ highest possible" value={`${num(c.rawScore)} ÷ ${num(c.highestPossibleScore)}`} />
                <Row label="Percentage score (PS)" value={`${fmt(c.percentageScore)}%`} />
                <Row label={`Weighted score: PS × ${pct(c.weight)}`} value={fmt(c.weightedScore)} total />
              </div>
            </>
          ) : (
            <div className="stat-explainer__calc">
              {c.parts.map((part) => (
                <Row
                  key={part.key}
                  label={`${part.label}: ${num(part.rawScore)} ÷ ${num(part.highestPossibleScore)} = ${fmt(part.percentageScore)}% × ${pct(part.weight)}`}
                  value={fmt(part.weightedScore)}
                />
              ))}
              <Row label="Examinations percentage (sum of the parts)" value={`${fmt(c.percentageScore)}%`} />
              <Row label={`Weighted score: PS × ${pct(c.weight)}`} value={fmt(c.weightedScore)} total />
            </div>
          )}
        </section>
      ))}

      <div className="stat-explainer__calc grade-breakdown__result">
        <Row label={`Initial grade = ${components.map((c) => fmt(c.weightedScore)).join(' + ')}`} value={fmt(initialGrade)} />
        <Row
          label={
            mode === 'zero_based'
              ? 'Term grade (zero-based: the initial grade rounded, no transmutation)'
              : "Term grade (transmuted with DepEd's adjusted table for SY 2026–2027)"
          }
          value={termGrade}
          total
        />
      </div>
      {gradeValue !== undefined && gradeValue !== null && Number(gradeValue) !== termGrade && (
        <p className="help-text">The grade on record is {num(gradeValue)}.</p>
      )}
      <p className="stat-explainer__rule">Computed as prescribed by {DEPED_SOURCE}.</p>
    </div>
  )
}

// A page opens a breakdown with `show(title, computation, gradeValue)` and
// renders `dialog` once — the same shape as useConfirm.
export function useGradeBreakdown() {
  const [state, setState] = useState(null)
  const show = useCallback((title, computation, gradeValue) => setState({ title, computation, gradeValue }), [])
  const dialog = (
    <Modal open={Boolean(state)} onClose={() => setState(null)} title={state?.title || ''}>
      {state && <GradeBreakdown computation={state.computation} gradeValue={state.gradeValue} />}
    </Modal>
  )
  return [show, dialog]
}
