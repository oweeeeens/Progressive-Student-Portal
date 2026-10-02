// Handles the "is this thing on" endpoints used to confirm the frontend,
// backend, and database are all wired together correctly.
const { checkDbConnection } = require('../config/db');

// GET /api/hello — confirms the Express server itself is reachable.
function getHello(req, res) {
  res.json({ message: 'Hello World from the Student Portal API!' });
}

// GET /api/health — confirms the Express server AND the PostgreSQL
// connection are both working, by round-tripping a query to the database.
async function getHealth(req, res) {
  try {
    const dbTime = await checkDbConnection();
    res.json({ status: 'ok', database: 'connected', dbTime });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
}

module.exports = { getHello, getHealth };
