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

// Below this many rows a repeated column costs little and dropping it would
// be more disruptive than leaving it — three identical values read as three
// values, not as a wall.
const UNIFORM_COLLAPSE_MIN_ROWS = 4

// Enough rows that the skeleton holds roughly a screen, so data landing
// does not drop the page out from under the reader.
const SKELETON_ROWS = 12

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

// Whether this cell holds the column's unremarkable value. Compared as a
// string so a page can declare `quietValue: 'present'` without caring
// whether the row carries a string, a number or an enum.
function isQuietCell(col, row) {
  if (col.quietValue === undefined || typeof col.uniformValue !== 'function') return false
  return String(col.uniformValue(row)) === String(col.quietValue)
}

// The one list component for the whole app.
//
// `columns`: [{ key, header, sortable, align, width, render(row),
//              primary, quietValue, uniformValue, truncate }]
//
// `primary: true` marks the ONE column that is the row's identity — the
// learner's name on a roster, the date in a register. It renders at full
// strength while every other cell drops to muted, which is how a paper
// register reads: the name carries the row and the supporting fields sit
// behind it. It also absorbs the table's spare width, so a short table
// stops spreading its columns across the whole page.
//
// `summaryText(row)` is what a collapsed column prints above the table,
// for when `uniformValue` is a composite comparison key rather than
// something readable.
//
// `quietValue` names the value that is UNREMARKABLE in that column —
// 'present' in an attendance register, 'enrolled' on a roster. A cell
// holding it renders quietly so the exceptions carry the page: thirteen
// saturated green "Present" pills used to drown the one "Late" and two
// "Absent" that are the entire reason to open the list. Declared by the
// page rather than inferred from a frequency count, because this app's
// argument is that its rules are explainable, and "the page says Present
// is the normal case" answers a question that "the component muted
// whatever was over 60%" does not.
// `illustration`: which spot drawing tops the empty state — see
//   components/illustrations/SpotIllustration.jsx. Defaults to the roster
//   sheet, which suits a list of people; pages showing marks, a register
//   or a queue should name theirs.
// `selection` — { selectedIds, onToggleRow, onToggleAll, label } adds a
//   leading checkbox column. The header checkbox reports the INDETERMINATE
//   state when some but not all rows are selected; the hand-rolled versions
//   this replaced showed "unchecked" with 3 of 20 ticked, which reads as
//   "nothing is selected" to anyone using a screen reader.
//
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
// A column whose every row holds the same value is LIFTED OUT of the table
// and stated once above it ("Recorded by Teresita M. Aquino"), and the
// column is dropped.
//
// This reverses an earlier decision to mute such a column in place so it
// "still earns its header". Muting was the right instinct aimed at the
// wrong target: a muted column of fifteen identical names is still fifteen
// repetitions of the same word occupying a quarter of the table. A line
// above it says the same thing once. The same applies to a column that is
// empty in every row — the register's NOTES column was fifteen em-dashes
// wide. See `collapsible` and `summaryNotes` below.
export function DataTable({
  columns,
  // Defaulted, because several callers hold their rows in state that starts
  // null and only becomes an array once the first request lands. "The one
  // list component for the whole app" should render an empty list in that
  // moment, not take the page down — and enough call sites already write
  // `rows={x ?? []}` defensively to show the hazard was known.
  rows = [],
  rowKey,
  selection,
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
  // Belt and braces alongside the `rows = []` default: the default only
  // applies to `undefined`, and the callers that bite are the ones holding
  // `null` in state until their first response lands.
  const safeRows = rows || []

  // Columns that say the same thing on every row. Two kinds:
  //
  //   uniform — every row carries an identical value ("Recorded by
  //             Teresita M. Aquino", fifteen times)
  //   empty   — every row is blank (a NOTES column of fifteen em-dashes)
  //
  // Both are dropped from the table. A uniform column's single value is
  // restated once above it; an empty column has nothing to restate and
  // simply goes. Only worth doing with enough rows for the repetition to
  // cost anything — below the threshold the column stays where it is.
  const collapsible =
    safeRows.length >= UNIFORM_COLLAPSE_MIN_ROWS
      ? columns
          .filter((col) => typeof col.uniformValue === 'function')
          // A column that declares a quietValue is never collapsed. The page
          // has said that this column's variation is the whole point of the
          // list — an attendance register without its Status column is not a
          // register — so on a day when nothing varies the right answer is
          // the quiet treatment, not removal.
          .filter((col) => col.quietValue === undefined)
          .map((col) => {
            const first = col.uniformValue(safeRows[0])
            if (!safeRows.every((row) => col.uniformValue(row) === first)) return null
            // uniformValue is a COMPARISON key and may be a composite
            // ("name|file"), which is not something to print. summaryText
            // gives the column a display form; without one the key is only
            // used when it is a plain value.
            const text = col.summaryText ? col.summaryText(safeRows[0]) : first
            const isBlank = text === null || text === undefined || text === ''
            return { key: col.key, header: col.header, value: text, isBlank }
          })
          .filter(Boolean)
      : []

  const selectedCount = selection ? safeRows.filter((row) => selection.selectedIds.has(rowKey(row))).length : 0
  const allSelected = selection ? selectedCount > 0 && selectedCount === safeRows.length : false
  const someSelected = selection ? selectedCount > 0 && selectedCount < safeRows.length : false

  const collapsedKeys = new Set(collapsible.map((c) => c.key))
  // Only the ones carrying an actual value get restated; a column that was
  // blank on every row has nothing to say.
  const summaryNotes = collapsible.filter((c) => !c.isBlank)
  const visibleColumns = columns.filter((col) => !collapsedKeys.has(col.key))

  if (loading && safeRows.length === 0) {
    return (
      <div className="data-table">
        <SkeletonTable rows={SKELETON_ROWS} columns={columns.length} />
        <LoadingAnnouncement />
      </div>
    )
  }

  if (safeRows.length === 0) {
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
  const to = page && pageSize ? Math.min(page * pageSize, total ?? safeRows.length) : safeRows.length
  const rowTotal = total ?? safeRows.length
  const totalPages = page && pageSize ? Math.max(Math.ceil(rowTotal / pageSize), 1) : 1

  function headerSortState(col) {
    if (!col.sortable || sort?.by !== col.key) return 'none'
    return sort.dir === 'desc' ? 'desc' : 'asc'
  }

  return (
    <div className="data-table">
      {legend && <div className="data-table__legend">{legend}</div>}

      {/* Columns that said the same thing on every row, said once instead.
          See the note on uniformValue above. */}
      {summaryNotes.length > 0 && (
        <p className="data-table__summary">
          {summaryNotes.map((note, i) => (
            <span key={note.key}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <span className="data-table__summary-label">{note.header}</span> {note.value}
            </span>
          ))}
        </p>
      )}

      <div className="table-card">
        <table>
          {caption && <caption className="data-table__caption">{caption}</caption>}
          <thead>
            <tr>
              {selection && (
                <th className="data-table__select-head">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    // The DOM property, not an attribute — there is no
                    // `indeterminate` in HTML, only in the element's API.
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={selection.onToggleAll}
                    aria-label={selection.label || 'Select all rows'}
                  />
                </th>
              )}
              {visibleColumns.map((col) => {
                const state = headerSortState(col)
                return (
                  <th
                    key={col.key}
                    style={{ width: col.width }}
                    className={[col.align === 'right' ? 'is-right' : '', col.primary ? 'is-primary' : '']
                      .filter(Boolean)
                      .join(' ') || undefined}
                  >
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
            {safeRows.map((row) => {
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
                    {selection && (
                      <td
                        className="data-table__select-cell"
                        // Ticking a box must not also fire the row's own
                        // click (navigate, or open a detail panel).
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selection.selectedIds.has(key)}
                          onChange={() => selection.onToggleRow(key)}
                          aria-label={`Select row ${key}`}
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        // The identity column leads; everything else sits
                        // behind it. `is-quiet` is the column's own
                        // unremarkable value — a register full of "Present"
                        // should let "Absent" carry the page.
                        className={[
                          col.align === 'right' ? 'is-right' : '',
                          col.primary ? 'is-primary' : '',
                          isQuietCell(col, row) ? 'is-quiet' : '',
                          col.truncate ? 'truncate-cell' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        // The tooltip the stylesheet has always claimed
                        // these cells carry. Every cell is nowrap +
                        // ellipsis, so without it a clipped value is
                        // unrecoverable by any means.
                        title={col.plainText ? col.plainText(row) : undefined}
                        // Read back as the field label when the table
                        // collapses to cards on a phone — see the
                        // max-width: 560px block in index.css.
                        data-label={typeof col.header === 'string' ? col.header : undefined}
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
                      <td colSpan={visibleColumns.length + (hasActions ? 1 : 0) + (selection ? 1 : 0)}>{expanded}</td>
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
