// Owns reads/writes against password_reset_tokens. Only ever stores/looks up
// by token_hash — the raw token never touches the database, see utils/password.js.
const { pool } = require('../config/db');

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// Invalidates any still-usable tokens for this user before issuing a new
// one, so an older emailed link can't still work alongside a newer request.
async function createForUser(userId, tokenHash) {
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
  const expiresAt = new Date(Date.now() + EXPIRY_MS);
  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );
}

// Only returns a row if it's genuinely still usable — unused and unexpired.
// Callers don't need to separately check those conditions.
async function findValidByHash(tokenHash) {
  const result = await pool.query(
    'SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function markUsed(id) {
  await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [id]);
}

module.exports = { createForUser, findValidByHash, markUsed };
