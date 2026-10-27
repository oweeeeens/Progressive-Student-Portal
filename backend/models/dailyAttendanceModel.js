// The adviser's official daily/homeroom register (DepEd SF2) — one row per
// student per day. This is the table the risk formula's attendance rate will
// read from (see schema notes), not subject_attendance_records.
const { pool } = require('../config/db');

// Which students belong to a section right now — used both to validate a
// bulk-submit roster and to build the "mark attendance for today" sheet.
async function getActiveStudentsInSection(sectionId) {
  const result = await pool.query(
    `SELECT id, first_name, last_name
     FROM students
     WHERE current_section_id = $1 AND is_active = TRUE
     ORDER BY last_name, first_name`,
    [sectionId]
  );
  return result.rows;
}

// Upserts one row per student for the given date. Re-submitting the same
// date just overwrites the previous entries (e.g. the adviser fixing a typo),
// rather than erroring on the UNIQUE(student_id, attendance_date) constraint.
async function recordAttendance({ gradingPeriodId, attendanceDate, recordedBy, entries, client, importId = null }) {
  const columns = ['student_id', 'grading_period_id', 'attendance_date', 'status', 'recorded_by', 'notes', 'import_id'];
  const params = [];
  const valueGroups = entries.map((entry) => {
    const row = [entry.studentId, gradingPeriodId, attendanceDate, entry.status, recordedBy, entry.notes || null, importId];
    const placeholders = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  // The bulk importer passes its transaction client so every date in an
  // import commits or rolls back together, plus the id of the import that
  // is writing these rows; every other caller passes neither and runs on
  // the shared pool with import_id NULL, exactly as before.
  //
  // import_id is in the DO UPDATE SET list on purpose. An adviser later
  // correcting an imported day from the marking sheet passes no importId,
  // so the row is set back to NULL and stops claiming an origin it no
  // longer has. Leaving it out of the SET would quietly keep the old
  // pointer on a row that is now hand-entered.
  const runner = client || pool;
  const result = await runner.query(
    `INSERT INTO daily_attendance_records (${columns.join(', ')})
     VALUES ${valueGroups.join(', ')}
     ON CONFLICT (student_id, attendance_date)
     DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes,
                   recorded_by = EXCLUDED.recorded_by, grading_period_id = EXCLUDED.grading_period_id,
                   import_id = EXCLUDED.import_id
     RETURNING id, student_id, attendance_date, status`,
    params
  );
  return result.rows;
}

// Roster for one date, with each student's existing record (if any) so the
// UI can show who's already been marked. LEFT JOIN means an unmarked student
// still appears, with status = null.
async function getRosterForDate(sectionId, attendanceDate) {
  const result = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name, dar.status, dar.notes
     FROM students s
     LEFT JOIN daily_attendance_records dar
       ON dar.student_id = s.id AND dar.attendance_date = $2
     WHERE s.current_section_id = $1 AND s.is_active = TRUE
     ORDER BY s.last_name, s.first_name`,
    [sectionId, attendanceDate]
  );
  return result.rows;
}

async function getHistoryForStudent(studentId, { from, to } = {}) {
  const clauses = ['dar.student_id = $1'];
  const params = [studentId];
  if (from) {
    params.push(from);
    clauses.push(`dar.attendance_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`dar.attendance_date <= $${params.length}`);
  }

  const result = await pool.query(
    `SELECT dar.id, dar.attendance_date, dar.status, dar.notes, dar.grading_period_id,
            gp.name AS grading_period_name, u.full_name AS recorded_by_name,
            -- LEFT JOIN, not JOIN: import_id is NULL on every hand-marked
            -- row, which is most of them. A non-null file name is what tells
            -- the reader this day came from a bulk import rather than the
            -- marking sheet.
            bi.file_name AS imported_from
     FROM daily_attendance_records dar
     JOIN grading_periods gp ON gp.id = dar.grading_period_id
     JOIN users u ON u.id = dar.recorded_by
     LEFT JOIN bulk_imports bi ON bi.id = dar.import_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY dar.attendance_date DESC`,
    params
  );

  const summary = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const row of result.rows) summary[row.status] += 1;

  return { records: result.rows, summary };
}

// The same per-period grouping as getAttendanceRatesByPeriod below, but
// broken out into the four statuses rather than collapsed to a single rate
// — the "My Progress" student view shows the actual day counts, since
// "70% attendance" doesn't tell a student whether that was two absences or
// twenty, which is the part they can act on.
async function getStatusCountsByPeriod(studentId) {
  const result = await pool.query(
    `SELECT gp.id AS grading_period_id, gp.name AS period_name, gp.sequence_number,
            COUNT(*) FILTER (WHERE dar.status = 'present')::int AS present,
            COUNT(*) FILTER (WHERE dar.status = 'absent')::int AS absent,
            COUNT(*) FILTER (WHERE dar.status = 'late')::int AS late,
            COUNT(*) FILTER (WHERE dar.status = 'excused')::int AS excused,
            COUNT(*)::int AS total_days
     FROM daily_attendance_records dar
     JOIN grading_periods gp ON gp.id = dar.grading_period_id
     WHERE dar.student_id = $1
     GROUP BY gp.id, gp.name, gp.sequence_number
     ORDER BY gp.sequence_number`,
    [studentId]
  );
  return result.rows;
}

// Per-grading-period attendance rate, ordered oldest-to-newest by the
// period's sequence_number — the series the risk engine's trend calculation
// walks (see riskEngine.js). "Present" counts both 'present' and 'late' (the
// student did attend); 'absent' and 'excused' both count against the rate,
// since an excused absence still means missed instruction time. This
// interpretation is documented here because, like the attendance-rate
// threshold itself, it hasn't been explicitly confirmed by the client.
// Scoped to one school year for the same reason as
// gradeModel.getFinalizedAveragesByPeriod — see the note there. This is the
// other series the risk trend walks.
async function getAttendanceRatesByPeriod(studentId, schoolYearId) {
  const result = await pool.query(
    `SELECT gp.id AS grading_period_id, gp.sequence_number,
            ROUND(
              100.0 * COUNT(*) FILTER (WHERE dar.status IN ('present', 'late')) / COUNT(*),
              2
            ) AS attendance_rate
     FROM daily_attendance_records dar
     JOIN grading_periods gp ON gp.id = dar.grading_period_id
     WHERE dar.student_id = $1 AND gp.school_year_id = $2
     GROUP BY gp.id, gp.sequence_number
     ORDER BY gp.sequence_number`,
    [studentId, schoolYearId]
  );
  return result.rows;
}

module.exports = {
  getActiveStudentsInSection,
  recordAttendance,
  getRosterForDate,
  getHistoryForStudent,
  getStatusCountsByPeriod,
  getAttendanceRatesByPeriod,
};
