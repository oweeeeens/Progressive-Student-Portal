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

// A plain YYYY-MM-DD rendered the way a register is read: weekday first,
// then day and month — "Fri 9 Oct".
//
// The weekday is the information. Absences cluster on Mondays and Fridays,
// which is a pattern an adviser is genuinely looking for, and it was
// invisible while the attendance table printed the raw ISO string the
// database returned. The same app's top bar has always formatted its date
// properly; this is that, shortened for a column.
//
// Parsed from the parts rather than `new Date(dateStr)`, which reads a bare
// YYYY-MM-DD as UTC midnight and then formats it in local time — shifting
// the day backwards for anyone west of Greenwich. The backend avoids the
// same trap deliberately (see backend/utils/schoolDate.js).
export function formatRegisterDate(dateStr) {
  if (!dateStr) return dateStr;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
