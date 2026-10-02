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
async function recordAttendance({ gradingPeriodId, attendanceDate, recordedBy, entries }) {
  const columns = ['student_id', 'grading_period_id', 'attendance_date', 'status', 'recorded_by', 'notes'];
  const params = [];
  const valueGroups = entries.map((entry) => {
    const row = [entry.studentId, gradingPeriodId, attendanceDate, entry.status, recordedBy, entry.notes || null];
    const placeholders = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const result = await pool.query(
    `INSERT INTO daily_attendance_records (${columns.join(', ')})
     VALUES ${valueGroups.join(', ')}
     ON CONFLICT (student_id, attendance_date)
     DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes,
                   recorded_by = EXCLUDED.recorded_by, grading_period_id = EXCLUDED.grading_period_id
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
            gp.name AS grading_period_name, u.full_name AS recorded_by_name
     FROM daily_attendance_records dar
     JOIN grading_periods gp ON gp.id = dar.grading_period_id
     JOIN users u ON u.id = dar.recorded_by
     WHERE ${clauses.join(' AND ')}
     ORDER BY dar.attendance_date DESC`,
    params
  );

  const summary = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const row of result.rows) summary[row.status] += 1;

  return { records: result.rows, summary };
}

// Per-grading-period attendance rate, ordered oldest-to-newest by the
// period's sequence_number — the series the risk engine's trend calculation
// walks (see riskEngine.js). "Present" counts both 'present' and 'late' (the
// student did attend); 'absent' and 'excused' both count against the rate,
// since an excused absence still means missed instruction time. This
// interpretation is documented here because, like the attendance-rate
// threshold itself, it hasn't been explicitly confirmed by the client.
async function getAttendanceRatesByPeriod(studentId) {
  const result = await pool.query(
    `SELECT gp.id AS grading_period_id, gp.sequence_number,
            ROUND(
              100.0 * COUNT(*) FILTER (WHERE dar.status IN ('present', 'late')) / COUNT(*),
              2
            ) AS attendance_rate
     FROM daily_attendance_records dar
     JOIN grading_periods gp ON gp.id = dar.grading_period_id
     WHERE dar.student_id = $1
     GROUP BY gp.id, gp.sequence_number
     ORDER BY gp.sequence_number`,
    [studentId]
  );
  return result.rows;
}

module.exports = {
  getActiveStudentsInSection,
  recordAttendance,
  getRosterForDate,
  getHistoryForStudent,
  getAttendanceRatesByPeriod,
};
