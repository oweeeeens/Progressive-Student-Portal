import { Search, X } from 'lucide-react'

// Search and filters for a list, in ONE row directly above the table, in
// the same position and the same order on every page: search first, then
// filters, then any page-level actions pushed to the right.
//
// Previously these lived in the page header next to the <h1>, mixed in with
// "New Student"-style buttons, so the controls that narrow the list and the
// controls that create things looked identical and sat in the same row.
export function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  filters,
  actions,
  isFiltered,
  onClearFilters,
}) {
  return (
    <div className="table-toolbar">
      {onSearchChange && (
        <div className="search-field">
          <Search size={16} strokeWidth={1.75} />
          <input type="search" placeholder={searchPlaceholder} value={search} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
      )}
      {filters}
      {isFiltered && onClearFilters && (
        <button type="button" className="table-toolbar__clear" onClick={onClearFilters}>
          <X size={13} strokeWidth={2} />
          Clear filters
        </button>
      )}
      {actions && <div className="table-toolbar__actions">{actions}</div>}
    </div>
  )
}

// A labelled control inside the toolbar — keeps every filter's label
// treatment identical instead of each page styling its own <label>.
export function TableFilter({ label, children }) {
  return (
    <label className="table-toolbar__filter">
      <span>{label}</span>
      {children}
    </label>
  )
}
