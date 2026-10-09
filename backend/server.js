// Entry point: loads config, (optionally) boots a local dev database, and
// starts the Express app (see app.js for route wiring) listening.
require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 5000;

// Starts the embedded dev PostgreSQL server when no system-wide PostgreSQL
// install is configured (see config/embeddedPostgres.js). Skipped entirely
// when USE_EMBEDDED_DB=false, e.g. once a real PostgreSQL server is in use.
async function start() {
  if (process.env.USE_EMBEDDED_DB === 'true') {
    const { startEmbeddedPostgres } = require('./config/embeddedPostgres');
    console.log('Starting embedded PostgreSQL for local development...');
    await startEmbeddedPostgres();
    console.log('Embedded PostgreSQL is ready.');
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
