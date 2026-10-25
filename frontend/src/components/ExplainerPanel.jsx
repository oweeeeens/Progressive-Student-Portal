import { X } from 'lucide-react'

// The container every "how is this worked out" panel sits in — the one the
// student's headline figures open underneath themselves.
//
// Extracted so the grades page's figures explain themselves in exactly the
// same way the home page's do: same heading, same place, same close button.
// A second panel that merely looked similar would be a second idea of what
// an explanation is, which is how two pages start answering the same
// question differently.
//
// The panel owns the chrome only. What goes inside it — the arithmetic, the
// list of checks, the ranking — belongs to whichever figure was clicked.
export function ExplainerPanel({ id, title, subtitle, onClose, children }) {
  return (
    <section className="panel stat-explainer" id={id} role="region" aria-label={`How ${title} is worked out`}>
      <header className="stat-explainer__head">
        <div>
          <h3>How this is worked out</h3>
          <p className="stat-explainer__subject">
            {title}
            {subtitle ? ` · ${subtitle}` : ''}
          </p>
        </div>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close explanation">
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      {children}
    </section>
  )
}
