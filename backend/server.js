// Entry point: loads config, (optionally) boots a local dev database, and
// starts the Express app (see app.js for route wiring) listening.
//
// The .env path is explicit because this file is started from two different
// working directories: backend/ in development (`npm run dev`) and the repo
// root in production (`npm start`, so one command can serve the built
// frontend too). dotenv resolves a bare '.env' against the CURRENT directory,
// so the root-started process silently found no file and every secret came
// back undefined. Deployments set real environment variables and have no
// .env at all, which is why this is quiet when the file is missing.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

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

// The embedded PostgreSQL runs as a CHILD of this process and does not stop
// when this process does. Left running it keeps its lock on .pgdata, and the
// next start fails with "lock file postmaster.pid already exists" or
// "pre-existing shared memory block is still in use" — which is what used to
// happen every time nodemon restarted on a file change.
//
// SIGUSR2 is nodemon's restart signal, SIGINT is Ctrl+C, SIGTERM is a kill.
// Node on Windows emulates these only partly, so this is a best effort, not
// a guarantee: clearStaleLockFile in config/embeddedPostgres.js is what
// recovers the cases no handler ever sees.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (process.env.USE_EMBEDDED_DB === 'true') {
    try {
      const { stopEmbeddedPostgres } = require('./config/embeddedPostgres');
      await stopEmbeddedPostgres();
      console.log('Embedded PostgreSQL stopped.');
    } catch (error) {
      console.error('Could not stop embedded PostgreSQL cleanly:', error?.message || error);
    }
  }

  // Re-raise with no listener attached, so the process dies from the signal
  // it was sent — nodemon waits for exactly that before restarting.
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2']) {
  process.once(signal, () => shutdown(signal));
}

start().catch((error) => {
  // embedded-postgres can reject with undefined, which printed a bare
  // "Failed to start server: undefined" and left nothing to act on.
  console.error('Failed to start server:', error?.message || error || 'unknown error');
  if (process.env.USE_EMBEDDED_DB === 'true') {
    console.error(
      'If this mentions a lock file or shared memory, a PostgreSQL process from an earlier run is still alive. ' +
        'Stop it (Windows: Stop-Process -Name postgres -Force) and start again.'
    );
  }
  process.exit(1);
});
