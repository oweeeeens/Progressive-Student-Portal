// Powers the Dashboard's "Recent Activity" feed — a merged, chronological
// view across four existing, already-timestamped tables (grades,
// enrollment_documents, interventions, daily_attendance_records). No new
// table: each event type is just a differently-shaped read of data that
// already exists for its own module.
//
// Visibility is two-layered, deliberately stricter than the general
// student-roster rule:
//   1. Which event TYPES a role can see at all (ROLES_BY_TYPE below) —
//      mirrors the route-level requireRole(...) gate each underlying
//      feature already uses elsewhere (e.g. enrollment documents are
//      admin/registrar-only everywhere in this app, so they're
//      admin/registrar-only here too — an adviser must never learn a
//      document was uploaded for a student in their own section just
//      because this feed also shows grade/attendance events for them).
//   2. Within an eligible type, the same appendScopeClause rule every
//      other student-scoped query in this app already uses.
const { pool } = require('../config/db');
const { appendScopeClause, BASE_FROM } = require('./studentModel');

const DOCUMENT_TYPE_LABELS = {
  report_card: 'Report card',
  birth_certificate: 'Birth certificate',
  sf10: 'SF10',
  other: 'Document',
};

const ROLES_BY_TYPE = {
  grade: ['admin', 'adviser', 'subject_teacher', 'guidance_counselor'],
  document: ['admin', 'registrar'],
  intervention: ['admin', 'adviser', 'guidance_counselor'],
  attendance: ['admin', 'adviser', 'registrar'],
};

async function recentGradeFinalizations(user, limit) {
  const clauses = ['s.is_active = TRUE', "g.status = 'finalized'", 'g.finalized_at IS NOT NULL'];
  const params = [];
  appendScopeClause(user, clauses, params);
  params.push(limit);

  const result = await pool.query(
    `SELECT g.finalized_at AS at, gp.name AS period_name, COUNT(*)::int AS grade_count, u.full_name AS actor_name
     ${BASE_FROM}
     JOIN grades g ON g.student_id = s.id
     JOIN grading_periods gp ON gp.id = g.grading_period_id
     JOIN users u ON u.id = g.finalized_by
     WHERE ${clauses.join(' AND ')}
     GROUP BY g.finalized_at, gp.name, u.full_name
     ORDER BY g.finalized_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((r) => ({
    type: 'grade_finalized',
    at: r.at,
    actorName: r.actor_name,
    description: `Finalized ${r.grade_count} grade${r.grade_count === 1 ? '' : 's'} for ${r.period_name}`,
  }));
}

async function recentDocumentUploads(user, limit) {
  const clauses = ['s.is_active = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);
  params.push(limit);

  const result = await pool.query(
    `SELECT ed.uploaded_at AS at, ed.document_type, s.first_name, s.last_name, u.full_name AS actor_name
     ${BASE_FROM}
     JOIN enrollment_documents ed ON ed.student_id = s.id
     JOIN users u ON u.id = ed.uploaded_by
     WHERE ${clauses.join(' AND ')}
     ORDER BY ed.uploaded_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((r) => ({
    type: 'document_uploaded',
    at: r.at,
    actorName: r.actor_name,
    description: `${DOCUMENT_TYPE_LABELS[r.document_type] || 'Document'} uploaded for ${r.last_name}, ${r.first_name}`,
  }));
}

// One row per intervention, not per status change (there's no separate
// status-change log) — created_at vs updated_at tells us whether the most
// recent thing that happened to it was "logged" or "status updated".
async function recentInterventionEvents(user, limit) {
  const clauses = ['s.is_active = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);
  params.push(limit);

  const result = await pool.query(
    `SELECT i.created_at, i.updated_at, i.status, s.first_name, s.last_name, u.full_name AS actor_name
     ${BASE_FROM}
     JOIN interventions i ON i.student_id = s.id
     JOIN users u ON u.id = i.logged_by
     WHERE ${clauses.join(' AND ')}
     ORDER BY i.updated_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((r) => {
    const changed = new Date(r.updated_at).getTime() !== new Date(r.created_at).getTime();
    return {
      type: 'intervention_status_changed',
      at: changed ? r.updated_at : r.created_at,
      actorName: r.actor_name,
      description: changed
        ? `Intervention for ${r.last_name}, ${r.first_name} marked ${r.status}`
        : `Intervention logged for ${r.last_name}, ${r.first_name}`,
    };
  });
}

// Grouped by (recorder, date) — a single "mark attendance" action inserts
// one row per student in the roster, and those should read as one event,
// not a flood of near-identical ones crowding out everything else.
async function recentAttendanceSubmissions(user, limit) {
  const clauses = ['s.is_active = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);
  params.push(limit);

  const result = await pool.query(
    `SELECT dar.attendance_date, MAX(dar.created_at) AS at, COUNT(*)::int AS student_count, u.full_name AS actor_name
     ${BASE_FROM}
     JOIN daily_attendance_records dar ON dar.student_id = s.id
     JOIN users u ON u.id = dar.recorded_by
     WHERE ${clauses.join(' AND ')}
     GROUP BY dar.attendance_date, dar.recorded_by, u.full_name
     ORDER BY at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((r) => ({
    type: 'attendance_submitted',
    at: r.at,
    actorName: r.actor_name,
    description: `Attendance recorded for ${r.student_count} student${r.student_count === 1 ? '' : 's'} on ${new Date(
      r.attendance_date
    ).toLocaleDateString()}`,
  }));
}

async function getRecentActivity(user, limit = 10) {
  const tasks = [];
  if (ROLES_BY_TYPE.grade.includes(user.role)) tasks.push(recentGradeFinalizations(user, limit));
  if (ROLES_BY_TYPE.document.includes(user.role)) tasks.push(recentDocumentUploads(user, limit));
  if (ROLES_BY_TYPE.intervention.includes(user.role)) tasks.push(recentInterventionEvents(user, limit));
  if (ROLES_BY_TYPE.attendance.includes(user.role)) tasks.push(recentAttendanceSubmissions(user, limit));

  if (tasks.length === 0) return [];

  const results = await Promise.all(tasks);
  return results
    .flat()
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);
}

module.exports = { getRecentActivity };
