import { useEffect, useState } from 'react';
import { setUnsavedChanges } from '../utils/unsavedChangesGuard';

// Shared by every page with a "local edits, explicit save" flow (the
// attendance roster pages, grade entry) — tracks whether `current` has
// drifted from its last-known-saved shape, and wires that into both the
// in-app nav guard (Sidebar/Breadcrumbs check unsavedChangesGuard before
// navigating) and the browser-level beforeunload case.
//
// `resetKey` is how this hook knows "a genuinely fresh value just landed"
// vs. "the existing value was edited" — pass a counter the caller bumps
// exactly when that happens: right after a fetch resolves AND right after a
// save succeeds. It can't be derived from whatever picker/id state triggered
// the fetch — that's already set before the async fetch resolves, so it
// can't mark the moment the data itself actually arrives (confirmed via a
// real save-then-reload test: using picker/date alone left the baseline
// stale and isDirty permanently true after a fresh load).
export function useUnsavedChangesTracker(current, resetKey, message) {
  // State, not a ref: isDirty is derived from this during render, and a ref
  // mutated inside an effect doesn't trigger the re-render needed to pick
  // that mutation up — isDirty would stay stuck at whatever it was computed
  // as the instant before the effect ran (also caught via a real
  // save-then-check test, not just inspection: it silently never cleared
  // after saving until this was state instead of a ref).
  const [baseline, setBaseline] = useState(current);
  useEffect(() => {
    setBaseline(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  const isDirty = JSON.stringify(current) !== JSON.stringify(baseline);

  useEffect(() => {
    setUnsavedChanges(isDirty, message);
    return () => setUnsavedChanges(false);
  }, [isDirty, message]);

  // The browser-level case (refresh, close tab, typed URL) — in-app
  // navigation is covered separately by Sidebar/Breadcrumbs checking
  // confirmLeave() before they navigate.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  return isDirty;
}
