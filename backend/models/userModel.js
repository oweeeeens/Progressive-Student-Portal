// Owns all reads/writes against the users table, including password hashing
// on the way in — callers never see or construct a password hash themselves.
const { pool } = require('../config/db');
const { hashPassword } = require('../utils/password');

const PUBLIC_COLUMNS = 'id, email, full_name, role, is_active, must_change_password, created_at, updated_at';

async function findByEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

// mustChangePassword defaults false so seed scripts (which call this
// directly, not through the HTTP API) keep producing immediately-usable
// accounts — only the staff/student account-provisioning flows pass true.
async function createUser({ email, password, fullName, role, mustChangePassword = false }) {
  const passwordHash = await hashPassword(password);
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, passwordHash, fullName, role, mustChangePassword]
  );
  return result.rows[0];
}

// Used by both the forgot-password self-service reset and the forced
// first-login change: sets a new password and always clears
// must_change_password — changing your password (deliberately, to something
// only you know) is what satisfies the forced-change requirement, whether
// or not it was actually pending.
async function updatePassword(userId, newPlainTextPassword) {
  const passwordHash = await hashPassword(newPlainTextPassword);
  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = now() WHERE id = $2',
    [passwordHash, userId]
  );
}

// Used by the admin/registrar-triggered reset fallback — the opposite of
// updatePassword: sets must_change_password = TRUE, since (unlike a
// self-service reset) the new password here is a system-generated temp
// value the user hasn't chosen themselves yet.
async function resetPasswordToTemp(userId, tempPlainTextPassword) {
  const passwordHash = await hashPassword(tempPlainTextPassword);
  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = now() WHERE id = $2',
    [passwordHash, userId]
  );
}

// The staff roster for admin/registrar's account management — everyone
// except students (who are managed via Student Records instead, keyed off
// their student profile rather than browsing a bare user list). Used as a
// plain, unfiltered picker source (Sections/Class Offerings' adviser/teacher
// dropdowns) — keep this shape stable; the filterable/paginated User
// Management list below is a separate function precisely so this one never
// has to change for that page's sake.
async function listStaff() {
  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE role != 'student' ORDER BY role, full_name`
  );
  return result.rows;
}

// Every role whose assignment lives on another table, and how to find "the
// section(s)/class(es) this user is tied to" plus filter by one — used by
// both the assignment-summary column and the sectionId filter in
// listAccounts. A plain CASE/EXISTS pair per role rather than a generic join,
// since each role's assignment table is shaped differently (sections.adviser_id
// is one-to-many, class_offerings is many-to-many via a join table, a
// student's section is a single column on a different table entirely).
const ASSIGNMENT_SUMMARY_SQL = `
  CASE u.role
    WHEN 'adviser' THEN (
      SELECT STRING_AGG(sec.name, ', ' ORDER BY sec.name)
      FROM sections sec WHERE sec.adviser_id = u.id AND sec.is_active = TRUE
    )
    WHEN 'subject_teacher' THEN (
      SELECT STRING_AGG(DISTINCT sec.name, ', ' ORDER BY sec.name)
      FROM class_offerings co JOIN sections sec ON sec.id = co.section_id
      WHERE co.teacher_id = u.id AND co.is_active = TRUE
    )
    WHEN 'student' THEN (
      SELECT sec.name FROM students s LEFT JOIN sections sec ON sec.id = s.current_section_id
      WHERE s.user_id = u.id
    )
    ELSE NULL
  END
`;

const ASSIGNMENT_FILTER_SQL = `(
  (u.role = 'adviser' AND EXISTS (SELECT 1 FROM sections sec WHERE sec.adviser_id = u.id AND sec.id = $SECTION_PARAM))
  OR (u.role = 'subject_teacher' AND EXISTS (
    SELECT 1 FROM class_offerings co WHERE co.teacher_id = u.id AND co.section_id = $SECTION_PARAM
  ))
  OR (u.role = 'student' AND EXISTS (
    SELECT 1 FROM students s WHERE s.user_id = u.id AND s.current_section_id = $SECTION_PARAM
  ))
)`;

// The full account roster for the User Management page — every role
// including students (unlike listStaff above), filterable by role, active
// status, and section/class assignment, with pagination/search to match the
// system-wide UI standard for list pages.
async function listAccounts({ search, role, status, sectionId, page = 1, pageSize = 20 } = {}) {
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (role) {
    params.push(role);
    clauses.push(`u.role = $${params.length}`);
  }
  if (status === 'active') {
    clauses.push('u.is_active = TRUE');
  } else if (status === 'inactive') {
    clauses.push('u.is_active = FALSE');
  }
  if (sectionId) {
    params.push(sectionId);
    clauses.push(ASSIGNMENT_FILTER_SQL.replaceAll('$SECTION_PARAM', `$${params.length}`));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(`SELECT COUNT(*) FROM users u ${where}`, params);
  const total = Number(countResult.rows[0].count);

  const limit = Math.min(Number(pageSize) || 20, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];

  const dataResult = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.must_change_password, u.created_at,
            ${ASSIGNMENT_SUMMARY_SQL} AS assignment_summary
     FROM users u
     ${where}
     ORDER BY u.role, u.full_name
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  return { accounts: dataResult.rows, total, page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

// Stat-card counts for the User Management page header — total, active,
// inactive, and accounts still pending their forced first-login password
// change, so the summary row always matches what's actually in the list below.
async function countAccounts() {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_active)::int AS active,
       COUNT(*) FILTER (WHERE NOT is_active)::int AS inactive,
       COUNT(*) FILTER (WHERE must_change_password)::int AS pending_first_login
     FROM users`
  );
  return result.rows[0];
}

// Guards role reassignment: a user actively advising a section or teaching a
// class offering can't have their role changed out from under those rows
// (sections.adviser_id / class_offerings.teacher_id would keep pointing at
// them with a role that no longer matches what every other module assumes).
// The admin must reassign those in Academic Setup first — this only answers
// "do any exist right now," not which ones.
async function hasActiveAssignments(id) {
  const result = await pool.query(
    `SELECT
       EXISTS (SELECT 1 FROM sections WHERE adviser_id = $1 AND is_active = TRUE) AS has_sections,
       EXISTS (SELECT 1 FROM class_offerings WHERE teacher_id = $1 AND is_active = TRUE) AS has_offerings`,
    [id]
  );
  return result.rows[0].has_sections || result.rows[0].has_offerings;
}

// Partial update for an account's identity fields — name/email/role. Only
// columns present in `data` are touched, same convention as
// studentModel.updateStudent, so the controller can send just what the
// admin actually changed.
const UPDATABLE_FIELDS = { fullName: 'full_name', email: 'email', role: 'role' };

async function updateUser(id, data) {
  const setClauses = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      params.push(data[key]);
      setClauses.push(`${column} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) {
    return findById(id);
  }

  setClauses.push('updated_at = now()');
  params.push(id);

  const result = await pool.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING ${PUBLIC_COLUMNS}`,
    params
  );
  return result.rows[0] || null;
}

// Activate/deactivate — the account keeps every historical record it's
// attached to (grades submitted, interventions logged, attendance marked);
// only is_active flips, which authMiddleware.js already re-checks on every
// request, so a deactivated account loses access immediately.
async function setActive(id, isActive) {
  const result = await pool.query(
    'UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING id, is_active',
    [isActive, id]
  );
  return result.rows[0] || null;
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  updatePassword,
  resetPasswordToTemp,
  listStaff,
  listAccounts,
  countAccounts,
  hasActiveAssignments,
  updateUser,
  setActive,
};
