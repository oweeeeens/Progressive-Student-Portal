import { ChevronLeft, ChevronRight } from 'lucide-react'

// First, last, current ± 1, with a single "…" filling any gap bigger than
// one — the standard compact numbered-pagination pattern, so a 40-page list
// never renders 40 buttons in a row.
function getPageNumbers(current, total) {
  const pages = []
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= 1) {
      pages.push(i)
    }
  }
  const withDots = []
  let previous = null
  for (const page of pages) {
    if (previous !== null && page - previous > 1) {
      withDots.push('…')
    }
    withDots.push(page)
    previous = page
  }
  return withDots
}

export function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null

  return (
    <nav className="pagination-nav" aria-label="Pagination">
      <button
        type="button"
        className="pagination-nav__arrow"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={16} strokeWidth={1.75} />
      </button>

      {getPageNumbers(page, totalPages).map((p, index) =>
        p === '…' ? (
          <span className="pagination-nav__ellipsis" key={`ellipsis-${index}`}>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={`pagination-nav__page${p === page ? ' is-active' : ''}`}
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        className="pagination-nav__arrow"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={16} strokeWidth={1.75} />
      </button>
    </nav>
  )
}
