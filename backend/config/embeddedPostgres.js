// Manages a local, file-based PostgreSQL server for development machines that
// don't have a system-wide PostgreSQL install (e.g. this project's dev setup).
// Only used when USE_EMBEDDED_DB=true in .env — point PG* env vars at a real
// PostgreSQL server instead and set USE_EMBEDDED_DB=false once one is available
// (e.g. the school's server, or a locally installed PostgreSQL).
const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;

const dataDir = path.join(__dirname, '..', '.pgdata');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  port: Number(process.env.PGPORT),
  persistent: true, // keep data on disk between restarts instead of wiping it
  // Without this, initdb inherits the Windows system locale's codepage
  // (e.g. WIN1252), which can't store arbitrary Unicode — a real problem for
  // names with diacritics. Force UTF8 regardless of host locale.
  initdbFlags: ['--encoding=UTF8'],
});

// PostgreSQL writes its own process id into postmaster.pid inside the data
// directory and refuses to start while that file is there. Two very
// different situations produce it, and telling them apart is the whole job
// of this function:
//
//   'running' — the process named in the file is alive. On a dev machine
//               that is almost always THIS project's server, left behind by
//               a nodemon restart: node is replaced, but the PostgreSQL it
//               spawned is a separate process that keeps running. Windows
//               gives the dying process no chance to stop it (nodemon kills
//               rather than signals), so this is the normal case, not an
//               exception.
//   'stale'   — the process is gone and only its lock survived, typically
//               after a crash or a forced kill.
//
// Returns 'running', 'stale' (after removing the dead lock), or 'none'.
function inspectLockFile() {
  const fs = require('fs');
  const lockFile = path.join(dataDir, 'postmaster.pid');
  if (!fs.existsSync(lockFile)) return 'none';

  const pid = Number(fs.readFileSync(lockFile, 'utf8').split('\n')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return 'none';

  try {
    // Signal 0 tests for a process's existence without touching it.
    process.kill(pid, 0);
    return 'running';
  } catch (error) {
    // EPERM means it exists but belongs to someone else — still running.
    if (error.code !== 'ESRCH') return 'running';
  }

  fs.unlinkSync(lockFile);
  console.warn(`Removed a stale postmaster.pid left by process ${pid}, which is no longer running.`);
  return 'stale';
}

// When this process is killed rather than asked to stop — which is what
// nodemon does on Windows every time a backend file is saved — PostgreSQL's
// postmaster goes with it, but its worker children can survive. A surviving
// worker still holds the cluster's shared memory, and the next start dies on
// "pre-existing shared memory block is still in use": the dev loop breaks on
// an ordinary file save, with an error that says nothing about why.
//
// This clears those leftovers, and is deliberately narrow about it:
//   - only when the embedded database is in use at all;
//   - only once the lock file says no postmaster is alive, so a RUNNING
//     server is never touched (that case is adopted instead, see below);
//   - only processes started from THIS project's embedded PostgreSQL binary,
//     never a PostgreSQL the machine runs for anything else.
// Windows only: elsewhere the signal reaches the process group and the
// children exit on their own.
function terminateOrphanedWorkers() {
  if (process.platform !== 'win32') return;

  const binaryDir = path.join(__dirname, '..', 'node_modules', '@embedded-postgres');
  // Win32_Process reports this binary's path with forward slashes while
  // path.join builds it with backslashes, so the match is made against the
  // form Windows actually reports.
  const binaryPattern = binaryDir.replace(/\\/g, '/');
  const { execFileSync } = require('child_process');
  const script =
    `Get-CimInstance Win32_Process -Filter "Name = 'postgres.exe'" |` +
    ` Where-Object { $_.CommandLine -like '*${binaryPattern}*' } |` +
    ' ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }';

  try {
    const killed = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10000,
    })
      .split(/\s+/)
      .filter(Boolean);
    if (killed.length > 0) {
      console.warn(`Cleared ${killed.length} orphaned PostgreSQL process(es) left by a previous run.`);
    }
  } catch (error) {
    // Never fatal: if the cleanup can't run, the start below either works
    // anyway or fails with its own (now explained) error.
    console.warn('Could not check for orphaned PostgreSQL processes:', error.message);
  }
}

// PostgreSQL accepts TCP connections a moment before it finishes recovery,
// answering "the database system is starting up" (SQLSTATE 57P03) in
// between. That window is normally invisible, but an adopted server (see
// startEmbeddedPostgres) can still be in it when this process connects
// seconds after the previous one started it — so the connection waits for
// readiness instead of treating a few hundred milliseconds as a failure.
async function connectWhenReady(attempts = 40, delayMs = 500) {
  for (let attempt = 1; ; attempt += 1) {
    const client = pg.getPgClient();
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      const stillComingUp = error.code === '57P03' || error.code === 'ECONNREFUSED';
      if (!stillComingUp || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Starts the embedded server, initializing its data directory on first run,
// and makes sure our app's database exists before the pool tries to connect.
async function startEmbeddedPostgres() {
  const fs = require('fs');
  const alreadyInitialized = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

  if (!alreadyInitialized) {
    await pg.initialise();
  }

  // A server already running against OUR data directory is this project's
  // own, so it is adopted rather than restarted: the connection below goes
  // over TCP and does not care which process started it. This is what makes
  // a nodemon restart seamless instead of a crash loop — before it, every
  // backend file change left an orphaned PostgreSQL holding the lock and the
  // next start died on "lock file postmaster.pid already exists".
  if (inspectLockFile() === 'running') {
    console.log('Embedded PostgreSQL is already running for this data directory — reusing it.');
  } else {
    // The lock said no postmaster is alive, so anything still running from
    // this project's PostgreSQL is a leftover worker holding the cluster's
    // shared memory. Clear it, or the start below fails.
    terminateOrphanedWorkers();
    await pg.start();
  }

  const dbName = process.env.PGDATABASE;
  const client = await connectWhenReady();
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (result.rowCount === 0) {
    await pg.createDatabase(dbName);
  }
  await client.end();
}

async function stopEmbeddedPostgres() {
  await pg.stop();
}

module.exports = { startEmbeddedPostgres, stopEmbeddedPostgres };
