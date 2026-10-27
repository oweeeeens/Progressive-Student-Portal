// Limits and vocabulary for the attendance grid importer, in one place —
// same split as config/bulkImport.js, so adding a mark symbol or raising a
// ceiling never means editing the parser or the validator.

// The importer reads a DepEd SF2-shaped sheet: students down the side, one
// column per school day, a mark in each cell.
const MAX_STUDENT_ROWS = 400;
const MAX_DATE_COLUMNS = 40; // a month of school days, with room to spare

// How many rows of the sheet the "point at the grid" step shows the user.
// Enough to include the school/section header block that SF2 forms carry
// above the day numbers.
const PREVIEW_ROWS = 15;

// The statuses the database accepts. Mirrors the attendance_status enum and
// the VALID_STATUSES in both attendance controllers.
const VALID_STATUSES = ['present', 'absent', 'late', 'excused'];

// What a mark in a cell most likely means, before the user confirms it on
// the mapping step. Keys are the normalized (lowercased, trimmed) cell text.
// Nothing here is authoritative — every symbol found in a file is shown with
// its count and can be remapped, because one school's "X" is an absence and
// another's is a tick.
const SYMBOL_GUESSES = {
  p: 'present',
  present: 'present',
  '/': 'present',
  '✓': 'present',
  '✔': 'present',
  a: 'absent',
  absent: 'absent',
  x: 'absent',
  '✗': 'absent',
  l: 'late',
  late: 'late',
  t: 'late', // "tardy"
  tardy: 'late',
  e: 'excused',
  excused: 'excused',
};

// The key the UI and validator use for an empty cell. A real SF2 is marked
// only where something happened, so blank almost always means present — but
// it is the single most consequential assumption in the whole import, so it
// is named, counted and shown rather than silently applied.
const BLANK_SYMBOL = '(blank)';
const BLANK_DEFAULT_STATUS = 'present';

// A cell the user has chosen not to import at all (a weekend column, a
// subtotal, a stray note). Not a status — these rows are simply not written.
const IGNORE_STATUS = 'ignore';

module.exports = {
  MAX_STUDENT_ROWS,
  MAX_DATE_COLUMNS,
  PREVIEW_ROWS,
  VALID_STATUSES,
  SYMBOL_GUESSES,
  BLANK_SYMBOL,
  BLANK_DEFAULT_STATUS,
  IGNORE_STATUS,
};
