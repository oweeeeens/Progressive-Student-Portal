// The product's one loading idiom.
//
// Before this there were three: a shimmer block hand-rolled as
// `<div className="skeleton" style={{ width: '70%', height: '0.9375rem' }} />`
// in four files, a bare `<p>Loading…</p>` in about twenty more — spelled six
// different ways, one of them with three dots and an inline padding — and a
// dim-in-place treatment on the Analytics charts. Three idioms for one state
// is how a product starts looking assembled rather than built.
//
// The rule now: if the shape of what is coming is known, draw that shape.
// A table knows it is about to hold rows; a feed knows it is about to hold
// entries. Only tell the user "Loading…" when nothing about the shape is
// known, which is almost never.

// A single shimmer bar. `w` and `h` accept any CSS length; the defaults suit
// a line of body text.
export function Skeleton({ w = '100%', h = '0.875rem', radius, className = '' }) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{ width: w, height: h, borderRadius: radius }}
    />
  )
}

// A stand-in for a table that is about to arrive: a header rule and `rows`
// lines, at the real row height, so the page does not jump when the data
// lands. Widths vary down the column because a block of identical bars reads
// as a loading graphic, while uneven ones read as text.
const ROW_WIDTHS = ['72%', '58%', '81%', '64%', '77%', '52%', '69%', '60%']

export function SkeletonTable({ rows = 6, columns = 4 }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      <div className="skeleton-table__head">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} w="42%" h="0.6875rem" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div className="skeleton-table__row" key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} w={ROW_WIDTHS[(r * columns + c) % ROW_WIDTHS.length]} />
          ))}
        </div>
      ))}
    </div>
  )
}

// A stand-in for a chart. Heights step down across the bars so the block
// reads as data arriving rather than as a progress graphic.
const CHART_HEIGHTS = ['62%', '88%', '47%', '73%', '35%', '80%', '55%']

export function SkeletonChart({ bars = 7 }) {
  return (
    <div className="skeleton-chart" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <Skeleton key={i} h={CHART_HEIGHTS[i % CHART_HEIGHTS.length]} w="100%" />
      ))}
    </div>
  )
}

// The accessible half. A shimmer is decoration — it says nothing to a screen
// reader, which is why every skeleton above is aria-hidden. This announces
// the state once, politely, and renders nothing visible.
export function LoadingAnnouncement({ children = 'Loading…' }) {
  return (
    <span className="sr-only" role="status">
      {children}
    </span>
  )
}
