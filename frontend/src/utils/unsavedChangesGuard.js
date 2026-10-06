// A tiny, page-agnostic "are there unsaved changes right now" flag. Any page
// with its own draft/form state (currently: the attendance roster pages) can
// set it; any in-app navigation trigger (Sidebar links, Breadcrumbs) checks
// it before leaving. Paired with a real `beforeunload` listener (see
// useUnsavedChangesGuard below) for the browser-level cases — refresh, tab
// close, a typed URL — that no amount of in-app guarding can intercept.
//
// Deliberately a plain module-level flag, not a React context: the
// navigation triggers live in components (Sidebar, Breadcrumbs) that have no
// other reason to know about any given page's form state, and a context
// would mean wrapping the whole app in a provider for one boolean that only
// one page at a time ever sets.
let dirty = false;
let message = 'You have unsaved changes. Leave this page without saving?';

export function setUnsavedChanges(isDirty, customMessage) {
  dirty = isDirty;
  if (customMessage) message = customMessage;
}

// Call before any in-app navigation (a Link/NavLink click, a logout button,
// etc.) — returns true if it's fine to proceed, false if the user chose to
// stay. Always true when nothing is dirty, so pages that never set this flag
// are completely unaffected.
export function confirmLeave() {
  if (!dirty) return true;
  return window.confirm(message);
}
