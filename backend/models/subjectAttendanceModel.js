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

async function recordAttendance({ classOfferingId, gradingPeriodId, attendanceDate, recordedBy, entries }) {
  const columns = ['student_id', 'class_offering_id', 'grading_period_id', 'attendance_date', 'status', 'recorded_by', 'notes'];
  const params = [];
  const valueGroups = entries.map((entry) => {
    const row = [entry.studentId, classOfferingId, gradingPeriodId, attendanceDate, entry.status, recordedBy, entry.notes || null];
    const placeholders = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const result = await pool.query(
    `INSERT INTO subject_attendance_records (${columns.join(', ')})
     VALUES ${valueGroups.join(', ')}
     ON CONFLICT (student_id, class_offering_id, attendance_date)
     DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes,
                   recorded_by = EXCLUDED.recorded_by, grading_period_id = EXCLUDED.grading_period_id
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
            subj.name AS subject_name, sec.name AS section_name
     FROM subject_attendance_records sar
     JOIN grading_periods gp ON gp.id = sar.grading_period_id
     JOIN users u ON u.id = sar.recorded_by
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

module.exports = { getActiveStudentsInOffering, recordAttendance, getRosterForDate, getHistoryForStudent };
