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

// Starts the embedded server, initializing its data directory on first run,
// and makes sure our app's database exists before the pool tries to connect.
async function startEmbeddedPostgres() {
  const fs = require('fs');
  const alreadyInitialized = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

  if (!alreadyInitialized) {
    await pg.initialise();
  }

  await pg.start();

  const dbName = process.env.PGDATABASE;
  const client = pg.getPgClient();
  await client.connect();
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
