# Student Portal — Setup

Full-stack scaffold: React (Vite) frontend, Node/Express backend, PostgreSQL database.

## Structure
```
backend/
  config/       # db.js (pg pool), embeddedPostgres.js (local dev DB bootstrap)
  controllers/  # request handlers, grouped by feature
  routes/       # route definitions, mounted under /api
  models/       # one file per entity, owns that entity's queries (empty — see models/README.md)
  server.js     # entry point
frontend/       # Vite + React app
```

## Running locally

**Backend**
```
cd backend
cp .env.example .env   # first time only
npm install
npm run dev
```
On first run this initializes a local PostgreSQL 18 data directory under `backend/.pgdata`
(see "Database" below) and starts the API on http://localhost:5000.

**Frontend**
```
cd frontend
npm install
npm run dev
```
Opens on http://localhost:5173. Vite proxies `/api/*` requests to the backend (see
`vite.config.js`), so `fetch('/api/hello')` works without CORS config in dev.

## Verify the connection
- `GET /api/hello` → `{ message: "Hello World from the Student Portal API!" }`
- `GET /api/health` → `{ status: "ok", database: "connected", dbTime: ... }` (round-trips a
  query to PostgreSQL)
- Loading http://localhost:5173 shows both of the above on the page.

## Database
No system-wide PostgreSQL install was available when this was set up, so the backend uses
the `embedded-postgres` npm package (`backend/config/embeddedPostgres.js`) to run a real,
local PostgreSQL 18 server out of `backend/.pgdata`, controlled by `USE_EMBEDDED_DB` in
`.env`. This is a genuine PostgreSQL instance (not a mock/in-memory substitute) — all SQL,
`pg` usage, and future models work unchanged against a "real" PostgreSQL server.

**To switch to a real/system PostgreSQL server later** (e.g. once installed, or a school
server is available): set `USE_EMBEDDED_DB=false` and point `PGHOST`/`PGPORT`/`PGUSER`/
`PGPASSWORD`/`PGDATABASE` in `.env` at it. No code changes needed — `config/db.js` always
reads from those same env vars.
