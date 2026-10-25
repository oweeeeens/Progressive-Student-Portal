// Generic status pill — each page maps its own domain's status values
// (enrollment status, document status, intervention status, ...) to a
// variant locally, rather than this component knowing about every domain.

// Most callers hand this the raw column value — 'enrolled',
// 'principal_verified', 'must_change_password' — which printed the
// database's spelling onto the page: a lowercase, underscored badge beside
// properly written labels everywhere else. Sentence case, not title case:
// "Pending first login" is a phrase, and Title Case Makes Every Badge Shout.
// Labels that are already written out (an imported LABELS map, "Performing
// Well") start with a capital and pass through untouched.
function toSentenceCase(label) {
  if (typeof label !== 'string') return label
  return label.replace(/_/g, ' ').replace(/^(\s*)([a-z])/, (_match, lead, first) => lead + first.toUpperCase())
}

export function StatusPill({ label, variant = 'neutral' }) {
  return <span className={`pill pill--${variant}`}>{toSentenceCase(label)}</span>
}
