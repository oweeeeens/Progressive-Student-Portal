// Plain date-string helpers (YYYY-MM-DD) for the attendance roster pages'
// Previous/Next/Today controls. String-based rather than juggling Date
// objects at the call sites, since attendance_date is a plain date with no
// time component — using local wall-clock parts (not UTC) for "today" is
// what makes it match the adviser's own calendar day.
export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function todayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
