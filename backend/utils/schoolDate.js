// Today's date as the school experiences it.
//
// Every "what grading period are we in" lookup used to be
// `new Date().toISOString().slice(0, 10)`, which is always UTC. The school
// is in the Philippines (UTC+8), so between midnight and 08:00 local time
// that string names YESTERDAY — and on the first or last day of a quarter
// that is the wrong grading period. For a read it means the dashboard shows
// the previous quarter for one morning; for a write it is permanent, which
// is why interventionController's date matters most.
//
// Built from Intl parts rather than arithmetic on a Date, for the same
// reason services/attendanceGridParser.js assembles its dates from parts:
// the result is a plain YYYY-MM-DD string that never shifts by an offset,
// and it matches what config/db.js hands back for a DATE column, so the two
// compare directly as strings.
const SCHOOL_TIMEZONE = process.env.SCHOOL_TIMEZONE || 'Asia/Manila';

// Cached: constructing a DateTimeFormat is the expensive part, and the
// dashboard asks for today several times per page load.
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHOOL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 'en-CA' formats as YYYY-MM-DD, which is exactly the shape we want — but
// the parts are read explicitly rather than trusting the locale's separator.
function todayInSchoolTimezone() {
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

module.exports = { todayInSchoolTimezone, SCHOOL_TIMEZONE };
