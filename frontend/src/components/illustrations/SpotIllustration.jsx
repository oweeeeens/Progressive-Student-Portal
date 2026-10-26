// The product's own spot drawings, for the moments when there is nothing to
// show yet.
//
// Authored here rather than imported: every one is built from the same three
// marks — a rounded rectangle, a hairline rule and a ray from the school
// seal's sunburst — so an empty Students page and an empty Attendance page
// look like drawings from one hand rather than two stock downloads. They
// cost no bytes beyond this file and no dependency.
//
// Colour comes entirely from CSS custom properties, so each drawing picks up
// the hue of the area it appears in (--module, set per route by Layout.jsx)
// and inverts correctly in dark mode without a second set of assets.
//
// They are decorative: every empty state says what is happening in words
// directly beneath, so these carry aria-hidden and add nothing for a screen
// reader to read out.

const SIZE = 104

// The sunburst, reduced to three rays. Reused by every drawing as the thing
// that marks them all as belonging to this school rather than to a template.
function Rays({ x, y }) {
  return (
    <g stroke="var(--module, var(--color-primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45">
      <line x1={x} y1={y} x2={x - 9} y2={y - 9} />
      <line x1={x + 6} y1={y - 3} x2={x + 6} y2={y - 16} />
      <line x1={x + 12} y1={y} x2={x + 21} y2={y - 9} />
    </g>
  )
}

// Shared chrome: the soft tinted plate every drawing sits on, which is what
// stops a thin line drawing from looking lost in a large empty panel.
function Plate({ children }) {
  return (
    <svg
      className="spot-illustration"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="52" cy="52" r="50" fill="color-mix(in srgb, var(--module, var(--color-primary)) 10%, transparent)" />
      {children}
    </svg>
  )
}

const STROKE = {
  stroke: 'var(--module, var(--color-primary))',
  strokeWidth: 2.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

// A roster that has nobody on it yet.
function RosterDrawing() {
  return (
    <Plate>
      <rect x="26" y="30" width="52" height="48" rx="6" {...STROKE} />
      <line x1="36" y1="46" x2="68" y2="46" {...STROKE} opacity="0.55" />
      <line x1="36" y1="56" x2="60" y2="56" {...STROKE} opacity="0.4" />
      <line x1="36" y1="66" x2="64" y2="66" {...STROKE} opacity="0.25" />
      <Rays x="60" y="24" />
    </Plate>
  )
}

// A register with no days marked in it.
function CalendarDrawing() {
  return (
    <Plate>
      <rect x="26" y="32" width="52" height="46" rx="6" {...STROKE} />
      <line x1="26" y1="45" x2="78" y2="45" {...STROKE} />
      <line x1="38" y1="26" x2="38" y2="36" {...STROKE} />
      <line x1="66" y1="26" x2="66" y2="36" {...STROKE} />
      <circle cx="40" cy="58" r="3.5" {...STROKE} opacity="0.5" />
      <circle cx="52" cy="58" r="3.5" {...STROKE} opacity="0.3" />
      <circle cx="64" cy="58" r="3.5" {...STROKE} opacity="0.3" />
      <Rays x="60" y="20" />
    </Plate>
  )
}

// A record sheet with no marks on it.
function GradesDrawing() {
  return (
    <Plate>
      <rect x="30" y="24" width="44" height="56" rx="6" {...STROKE} />
      <line x1="40" y1="40" x2="64" y2="40" {...STROKE} opacity="0.5" />
      <line x1="40" y1="52" x2="56" y2="52" {...STROKE} opacity="0.35" />
      <path d="M40 64 L46 70 L64 52" {...STROKE} opacity="0.9" />
      <Rays x="64" y="18" />
    </Plate>
  )
}

// A search that matched nothing.
function SearchDrawing() {
  return (
    <Plate>
      <circle cx="46" cy="46" r="18" {...STROKE} />
      <line x1="59" y1="59" x2="74" y2="74" {...STROKE} />
      <line x1="39" y1="46" x2="53" y2="46" {...STROKE} opacity="0.45" />
      <Rays x="62" y="24" />
    </Plate>
  )
}

// Nothing left in the queue — the good kind of empty.
function ClearedDrawing() {
  return (
    <Plate>
      <circle cx="52" cy="52" r="24" {...STROKE} />
      <path d="M41 52 L49 60 L65 44" {...STROKE} />
      <Rays x="66" y="22" />
    </Plate>
  )
}

// Support that has not been needed yet.
function SupportDrawing() {
  return (
    <Plate>
      <path d="M52 74 C30 60 28 44 38 38 C45 34 51 38 52 44 C53 38 59 34 66 38 C76 44 74 60 52 74 Z" {...STROKE} />
      <Rays x="66" y="24" />
    </Plate>
  )
}

const DRAWINGS = {
  roster: RosterDrawing,
  calendar: CalendarDrawing,
  grades: GradesDrawing,
  search: SearchDrawing,
  cleared: ClearedDrawing,
  support: SupportDrawing,
}

// `name` picks the drawing; an unknown name falls back to the roster sheet
// rather than rendering nothing, so a typo degrades to a plain empty state
// instead of a hole in the page.
export function SpotIllustration({ name = 'roster' }) {
  const Drawing = DRAWINGS[name] || RosterDrawing
  return <Drawing />
}
