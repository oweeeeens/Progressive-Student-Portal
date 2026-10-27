// Per-subject/period attendance, logged by the subject teacher who owns the
// class_offering. Separate from daily_attendance_records (the adviser's
// SF2 register) — see dailyAttendanceModel.js for that one.
const { pool } = require('../config/db');

// Students currently in the section a class_offering teaches.
async function getActiveStudentsInOffering(classOfferingId) {
  const result = await pool.query(
    `SELECT s.id, s.first_name, s.last_name
     FROM students s
     JOIN class_offerings co ON co.section_id = s.current_section_id
     WHERE co.id = $1 AND s.is_active = TRUE
     ORDER BY s.last_name, s.first_name`,
    [classOfferingId]
  );
  return result.rows;
}

async function recordAttendance({ classOfferingId, gradingPeriodId, attendanceDate, recordedBy, entries, client, importId = null }) {
  const columns = ['student_id', 'class_offering_id', 'grading_period_id', 'attendance_date', 'status', 'recorded_by', 'notes', 'import_id'];
  const params = [];
  const valueGroups = entries.map((entry) => {
    const row = [entry.studentId, classOfferingId, gradingPeriodId, attendanceDate, entry.status, recordedBy, entry.notes || null, importId];
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
    `INSERT INTO subject_attendance_records (${columns.join(', ')})
     VALUES ${valueGroups.join(', ')}
     ON CONFLICT (student_id, class_offering_id, attendance_date)
     DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes,
                   recorded_by = EXCLUDED.recorded_by, grading_period_id = EXCLUDED.grading_period_id,
                   import_id = EXCLUDED.import_id
     RETURNING id, student_id, attendance_date, status`,
    params
  );
  return result.rows;
}

async function getRosterForDate(classOfferingId, attendanceDate) {
  const result = await pool.query(
    `SELECT s.id AS student_id, s.first_name, s.last_name, sar.status, sar.notes
     FROM students s
     JOIN class_offerings co ON co.section_id = s.current_section_id
     LEFT JOIN subject_attendance_records sar
       ON sar.student_id = s.id AND sar.class_offering_id = co.id AND sar.attendance_date = $2
     WHERE co.id = $1 AND s.is_active = TRUE
     ORDER BY s.last_name, s.first_name`,
    [classOfferingId, attendanceDate]
  );
  return result.rows;
}

async function getHistoryForStudent(studentId, { classOfferingId, from, to } = {}) {
  const clauses = ['sar.student_id = $1'];
  const params = [studentId];
  if (classOfferingId) {
    params.push(classOfferingId);
    clauses.push(`sar.class_offering_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    clauses.push(`sar.attendance_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`sar.attendance_date <= $${params.length}`);
  }

  const result = await pool.query(
    `SELECT sar.id, sar.attendance_date, sar.status, sar.notes, sar.grading_period_id,
            gp.name AS grading_period_name, u.full_name AS recorded_by_name,
            subj.name AS subject_name, sec.name AS section_name,
            -- LEFT JOIN below, so this is NULL on every hand-marked row —
            -- a file name is what says the day came from a bulk import.
            bi.file_name AS imported_from
     FROM subject_attendance_records sar
     JOIN grading_periods gp ON gp.id = sar.grading_period_id
     JOIN users u ON u.id = sar.recorded_by
     LEFT JOIN bulk_imports bi ON bi.id = sar.import_id
     JOIN class_offerings co ON co.id = sar.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY sar.attendance_date DESC`,
    params
  );

  const summary = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const row of result.rows) summary[row.status] += 1;

  return { records: result.rows, summary };
}

// Per-SUBJECT totals for one student, current school year only — the
// "which classes am I actually missing?" question that the daily/SF2 figure
// cannot answer, since that one counts whole school days.
//
// Scoped to the current school year through the grading period (subject
// attendance rows carry no school_year of their own), so last year's
// records can't quietly inflate this year's counts. Counted in SQL rather
// than walked in the controller, the same shape dailyAttendanceModel's
// getStatusCountsByPeriod already uses.
async function getSubjectSummaryForStudent(studentId) {
  const result = await pool.query(
    `SELECT subj.name AS subject_name,
            teacher.full_name AS teacher_name,
            COUNT(*) FILTER (WHERE sar.status = 'present')::int AS present,
            COUNT(*) FILTER (WHERE sar.status = 'absent')::int AS absent,
            COUNT(*) FILTER (WHERE sar.status = 'late')::int AS late,
            COUNT(*) FILTER (WHERE sar.status = 'excused')::int AS excused,
            COUNT(*)::int AS total_sessions
     FROM subject_attendance_records sar
     JOIN class_offerings co ON co.id = sar.class_offering_id
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN users teacher ON teacher.id = co.teacher_id
     JOIN grading_periods gp ON gp.id = sar.grading_period_id
     JOIN school_years sy ON sy.id = gp.school_year_id
     WHERE sar.student_id = $1 AND sy.is_current = TRUE
     GROUP BY subj.name, teacher.full_name
     ORDER BY subj.name`,
    [studentId]
  );
  return result.rows;
}

module.exports = {
  getActiveStudentsInOffering,
  recordAttendance,
  getRosterForDate,
  getHistoryForStudent,
  getSubjectSummaryForStudent,
};
