import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ExplainerPanel } from './ExplainerPanel'

// "What exactly is this number counting?" — the panel that opens under a row
// of staff-facing stat cards.
//
// HOW THIS DIFFERS FROM StatExplainer. That one explains a student's own
// figures by showing the arithmetic: the marks, the division, the result.
// That is the right shape there, because those numbers ARE a calculation and
// the student is entitled to check it. These numbers are almost all counts
// of a filtered list, where the arithmetic is trivial and useless — "2
// at-risk students" is not explained by showing 1 + 1. What a reader
// actually needs is the DEFINITION: which rows were counted, which were
// deliberately left out, and where to go to see them.
//
// So this is declarative rather than bespoke: a page describes each figure
// as content, and the panel renders it the same way every time. A hand-
// written component per figure would have meant ~28 of them, each a fresh
// chance for one page to answer "what does this count" in a different shape
// from the next.
//
// THE ONE RULE THAT MATTERS: a `breakdown` or `items` must be derived from
// data the page already fetched, never a second request. StatExplainer's
// header makes the same point and it holds doubly here — an explanation that
// goes and asks the server again can disagree with the figure it is sitting
// underneath, which is worse than not explaining it at all. It also keeps
// per-role scoping correct for free: the page's data was already fetched
// under this user's permissions, so a breakdown of it cannot leak past them.
//
// `detail` shape, every field optional except title:
//   title       what the figure is called
//   subtitle    usually the value itself, shown beside the title
//   definition  the lead sentence: what is being counted
//   rules       bullets — what is included, excluded, or worth knowing
//   breakdown   [{ label, value }] sub-counts, from page data
//   footnote    a closing caveat
//   action      { to, label } a link to the list this figure summarises
export function StatDetail({ id, detail, onClose }) {
  if (!detail) return null

  const { title, subtitle, definition, rules, breakdown, footnote, action } = detail

  return (
    <ExplainerPanel id={id} title={title} subtitle={subtitle} onClose={onClose}>
      {definition && <p className="stat-explainer__lead">{definition}</p>}

      {breakdown && breakdown.length > 0 && (
        <div className="stat-explainer__calc">
          {breakdown.map((row) => (
            <div
              key={row.label}
              className={`stat-explainer__row${row.isTotal ? ' is-total' : ''}`}
            >
              <span>{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {rules && rules.length > 0 && (
        <ul className="stat-detail__rules">
          {rules.map((rule, index) => (
            // Index keys are safe here and only here: these are static
            // strings declared beside the figure, never a reordered or
            // filtered list.
            <li key={index}>{rule}</li>
          ))}
        </ul>
      )}

      {footnote && <p className="stat-explainer__rule">{footnote}</p>}

      {action && (
        <p className="stat-detail__action">
          <Link to={action.to}>
            {action.label}
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </p>
      )}
    </ExplainerPanel>
  )
}
