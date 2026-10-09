// Boots the REAL Express app (backend/app.js — the same route wiring
// server.js uses) on an ephemeral port, so the suite exercises the actual
// routes -> middleware -> controllers -> models -> database chain, not a
// re-implemented stand-in. Does NOT start embedded Postgres — the suite
// assumes the dev database is already running (same assumption
// migrate/seed scripts make), since spinning up/tearing down a whole
// embedded-postgres instance per test run would be slow and is unnecessary
// when `npm run dev` (or an already-running backend) already has one up.
require('dotenv').config();

const app = require('../../../app');

function startTestServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        // http.Server#close() waits for every open connection to end before
        // its callback fires — fetch()/undici keeps connections alive by
        // default, so without this a still-open keep-alive socket from the
        // last request hangs close() (and the whole test process) forever.
        // closeAllConnections() forces them shut immediately; safe here
        // since by the time a test file's after() hook runs, every request
        // it cares about has already completed.
        close: () =>
          new Promise((res) => {
            server.closeAllConnections();
            server.close(res);
          }),
      });
    });
    server.on('error', reject);
  });
}

module.exports = { startTestServer };
