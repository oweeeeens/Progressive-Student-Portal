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
// their student profile rather than browsing a bare user list).
async function listStaff() {
  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE role != 'student' ORDER BY role, full_name`
  );
  return result.rows;
}

module.exports = { findByEmail, findById, createUser, updatePassword, resetPasswordToTemp, listStaff };
