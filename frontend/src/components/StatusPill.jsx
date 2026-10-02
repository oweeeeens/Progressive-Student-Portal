// Generic status pill — each page maps its own domain's status values
// (enrollment status, document status, intervention status, ...) to a
// variant locally, rather than this component knowing about every domain.
export function StatusPill({ label, variant = 'neutral' }) {
  return <span className={`pill pill--${variant}`}>{label}</span>
}
