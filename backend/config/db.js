// Shared PostgreSQL connection pool, used by every model in this app.
// Connection details come from .env (see .env.example) so switching between
// the local embedded dev database and a real PostgreSQL server is just an
// env change, not a code change.
const { Pool, types } = require('pg');

// By default node-postgres parses DATE columns into JS Date objects, which
// silently shifts the value by a day whenever the server's local timezone
// isn't UTC (a date like date_of_birth has no time component or timezone of
// its own — converting it to one is simply wrong). Return the raw
// 'YYYY-MM-DD' string instead. OID 1082 = date.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

// Simple connectivity check used by the /api/health endpoint to confirm the
// backend can actually reach PostgreSQL, not just that the server booted.
async function checkDbConnection() {
  const result = await pool.query('SELECT NOW() AS current_time');
  return result.rows[0].current_time;
}

module.exports = { pool, checkDbConnection };
