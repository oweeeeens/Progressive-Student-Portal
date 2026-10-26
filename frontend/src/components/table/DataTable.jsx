import { Fragment } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { SpotIllustration } from '../illustrations/SpotIllustration'
import { SkeletonTable, LoadingAnnouncement } from '../Skeleton'
import { RowMenu } from './RowMenu'

// The value shown wherever a field is missing — ONE spelling, used by every
// table AND every detail page (see fieldValue below). Tables used to print
// an em-dash while profile pages printed an italic "Not provided", so the
// same absent field looked like two different states depending on where you
// read it.
export const EMPTY_VALUE = '—'

// Wraps a possibly-missing value for display. Returns the em-dash in a muted
// span so "no value" is visibly quieter than a real one, rather than reading
// as data.
export function fieldValue(value) {
  if (value === null || value === undefined || value === '') {
    return <span className="is-empty-value">{EMPTY_VALUE}</span>
  }
  return value
}

// Every sortable column carries an affordance, not just the active one —
// otherwise sortability is invisible until you happen to click the right
// header. The inactive state is a muted up/down glyph; the active one is a
// solid single arrow in the primary colour.
function SortAffordance({ state }) {
  if (state === 'asc') return <ChevronUp size={14} strokeWidth={2} className="data-table__sort is-active" />
  if (state === 'desc') return <ChevronDown size={14} strokeWidth={2} className="data-table__sort is-active" />
  return <ChevronsUpDown size={13} strokeWidth={2} className="data-table__sort" />
}

// The one list component for the whole app.
//
// `columns`: [{ key, header, sortable, align, width, render(row), muted }]
// `illustration`: which spot drawing tops the empty state — see
//   components/illustrations/SpotIllustration.jsx. Defaults to the roster
//   sheet, which suits a list of people; pages showing marks, a register
//   or a queue should name theirs.
// `rows`, `rowKey(row)`
// `onRowClick(row)`        — whole row becomes clickable + keyboard-operable
// `rowActions(row)`        — array for the trailing "⋮" menu
// `sort` / `onSortChange`  — { by, dir }
// `legend`                 — nodes rendered directly above the table, for
//                            explaining any mark that appears inside it
// `emptyState` / `noResultsState` — DELIBERATELY two different things: an
//   empty list ("No students yet") and a filtered-to-nothing list ("No
//   students match your filters") are different situations needing
//   different wording and different ways out.
// `isFiltered`             — which of those two to show
// `page`/`pageSize`/`total`/`onPageChange` — row count + pagination
//
// A column whose every row holds the same value is rendered MUTED rather
// than dropped: the column still earns its header (the reader can see the
// field exists and that nothing varies) without a full-strength column of
// identical text competing with the data that does differ. See
// `uniformColumnKeys`.
export function DataTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowActions,
  sort,
  onSortChange,
  legend,
  isFiltered = false,
  emptyState,
  noResultsState,
  illustration = 'roster',
  // While the first request is in flight the table draws itself at the
  // right size instead of the page swapping a sentence for a table and
  // jumping. Pages that already branch to their own loading text can
  // simply pass this through and delete the branch.
  loading = false,
  // Set when the request behind this table failed. An empty table then
  // means "nothing could be read", which is a different statement from
  // "there is nothing here" or "nothing matches your filters" — and the
  // page's own Alert above already explains why.
  error = null,
  page,
  pageSize,
  total,
  onPageChange,
  caption,
  // Inline expansion: some lists open a detail panel in place rather than
  // navigating (Interventions, Academic Progress). `renderExpanded(row)`
  // returns the panel, or null when that row has nothing open — the page
  // owns the condition, which matters because a row can have more than one
  // reason to expand (a detail view AND an intervention form).
  renderExpanded,
}) {
  const hasActions = typeof rowActions === 'function'

  // Columns where every row carries the same value — muted, not removed.
  const uniformColumnKeys = new Set(
    rows.length > 1
      ? columns
          .filter((col) => typeof col.uniformValue === 'function')
          .filter((col) => {
            const first = col.uniformValue(rows[0])
            return rows.every((row) => col.uniformValue(row) === first)
          })
          .map((col) => col.key)
      : []
  )

  if (loading && rows.length === 0) {
    return (
      <div className="data-table">
        <SkeletonTable rows={6} columns={Math.min(columns.length, 4)} />
        <LoadingAnnouncement />
      </div>
    )
  }

  if (rows.length === 0) {
    if (error) {
      return (
        <div className="empty-state">
          <SpotIllustration name="search" />
          <p>This list could not be loaded.</p>
        </div>
      )
    }
    // A filtered-to-nothing list and a genuinely empty one are different
    // situations and get different drawings: one is "look again", the other
    // is "there is nothing here yet". `illustration` lets a page name a more
    // specific one (a register, a mark sheet) than the roster default.
    return (
      <div className="empty-state">
        <SpotIllustration name={isFiltered ? 'search' : illustration} />
        {isFiltered ? noResultsState : emptyState}
      </div>
    )
  }

  const from = page && pageSize ? (page - 1) * pageSize + 1 : 1
  const to = page && pageSize ? Math.min(page * pageSize, total ?? rows.length) : rows.length
  const rowTotal = total ?? rows.length
  const totalPages = page && pageSize ? Math.max(Math.ceil(rowTotal / pageSize), 1) : 1

  function headerSortState(col) {
    if (!col.sortable || sort?.by !== col.key) return 'none'
    return sort.dir === 'desc' ? 'desc' : 'asc'
  }

  return (
    <div className="data-table">
      {legend && <div className="data-table__legend">{legend}</div>}

      <div className="table-card">
        <table>
          {caption && <caption className="data-table__caption">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((col) => {
                const state = headerSortState(col)
                return (
                  <th key={col.key} style={{ width: col.width }} className={col.align === 'right' ? 'is-right' : undefined}>
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="sortable-header"
                        aria-sort={state === 'none' ? 'none' : state === 'asc' ? 'ascending' : 'descending'}
                        onClick={() => onSortChange(col.key)}
                      >
                        {col.header}
                        <SortAffordance state={state} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
              {hasActions && <th className="is-right data-table__actions-head">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row)
              const clickable = Boolean(onRowClick)
              const expanded = renderExpanded ? renderExpanded(row) : null
              const isExpanded = Boolean(expanded)
              return (
                <Fragment key={key}>
                  <tr
                    className={clickable ? 'is-clickable-row' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    aria-expanded={renderExpanded ? isExpanded : undefined}
                    onClick={clickable ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter') onRowClick(row)
                          }
                        : undefined
                    }
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          col.align === 'right' ? 'is-right' : '',
                          uniformColumnKeys.has(col.key) ? 'is-uniform' : '',
                          col.truncate ? 'truncate-cell' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                    {hasActions && (
                      <td className="is-right data-table__actions-cell">
                        <RowMenu actions={rowActions(row)} />
                      </td>
                    )}
                  </tr>
                  {isExpanded && (
                    <tr className="detail-row">
                      <td colSpan={columns.length + (hasActions ? 1 : 0)}>{expanded}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Row count on every list, always — even a single unpaginated page
          says how much it is showing, so a reader never has to guess
          whether they're looking at everything. */}
      <div className="data-table__footer">
        <span className="data-table__count">
          Showing {from}–{to} of {rowTotal}
        </span>
        {totalPages > 1 && (
          <div className="pagination">
            <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
