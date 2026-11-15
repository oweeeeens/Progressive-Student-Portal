// Owns reads/writes against password_reset_tokens, which now holds emailed
// 6-digit reset CODES. Only a keyed hash of each code is stored — the code
// itself never touches the database (see utils/password.js).
const { pool } = require('../config/db');

// Issues a new code for this user, retiring every earlier one first, so only
// the newest email's code works — an older code still sitting in the inbox
// cannot be used alongside it.
async function createForUser(userId, codeHash, ttlMs) {
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, codeHash, expiresAt]
  );
}

// The user's one usable code, if any: unused and unexpired. Looked up by
// account, never by hash alone — a six-digit code is only meaningful
// together with the email it was sent to.
async function findActiveForUser(userId) {
  const result = await pool.query(
    `SELECT * FROM password_reset_tokens
     WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

// A wrong guess. Counted in the database (not in memory) so it survives a
// server restart, and the code is burned on the guess that reaches the
// limit — after that even the right code is refused and a new one has to be
// requested. Returns the attempts used so far.
async function recordFailedAttempt(id, maxAttempts) {
  const result = await pool.query(
    `UPDATE password_reset_tokens
     SET failed_attempts = failed_attempts + 1,
         used_at = CASE WHEN failed_attempts + 1 >= $2 THEN now() ELSE used_at END
     WHERE id = $1
     RETURNING failed_attempts`,
    [id, maxAttempts]
  );
  return result.rows[0] ? result.rows[0].failed_attempts : maxAttempts;
}

async function markUsed(id) {
  await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [id]);
}

module.exports = { createForUser, findActiveForUser, recordFailedAttempt, markUsed };
