# Student Portal — DepEd Progressive Senior High School, Bacoor City

A web portal that replaces the school's paper and spreadsheet record-keeping,
and adds a layer on top of it: it watches each learner's grades and
attendance over time, flags the ones whose figures are heading the wrong way,
and then tracks whether the adviser's response actually helped.

Capstone project, ITEC 200-A, Cavite State University – Imus Campus.
Dodge Carlson Paolo B. Bautista · Mark Cyrus S. Supan · Paul Owen J. Havana.
Adviser: Grace S. Ibañez, MSCS.

React (Vite) · Node/Express · PostgreSQL.

- **[CLAUDE.md](CLAUDE.md)** — the specification: scope, the risk formula, the
  approval workflow, role permissions, and the decisions behind them. Read
  this first to understand *what* the system does and why.
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — putting it on Railway. This page is
  local development only.

---

## What it does

**Student records.** One digital record per learner, replacing the paper
files and Excel sheets. Scoped by role: an adviser sees their own advisory
section, a subject teacher sees the learners they teach, a student sees only
themselves.

**Attendance**, at two levels. The adviser's daily/homeroom register is the
official DepEd SF2 record and is what the risk formula reads. Subject
teachers log their own per-class attendance separately; that is supplementary
and never feeds risk scoring. Both can be filled in by hand or imported in
bulk from the school's existing SF2 spreadsheets.

**Grades**, through a three-stage approval chain. A subject teacher submits,
the principal verifies or rejects with a note, the adviser finalizes into the
official record. Only finalized grades count toward risk.

**Academic Progress Tracking** — the innovation. Each learner is placed in
one of three bands per grading period (At Risk / Average–Steady / Performing
Well) from a transparent, rule-based formula. There is no AI and no black
box: four factors, two points each, and a trend of
`(latest − earliest) ÷ periods`. A flagged learner gets a fixed advisory
message per triggered factor, and the number they would have to reach to
clear it.

**Intervention tracking** — the closed loop. When a learner is flagged, the
adviser or guidance counselor logs what they did about it. At the next
recalculation the system compares the new risk level to the level when the
intervention was logged, and resolves or escalates it automatically.

Plus: school-wide analytics with PDF/Excel export, printable report cards,
announcements, bulk imports, and user management.

---

## Running it locally

Two terminals. The backend brings its own PostgreSQL (see **Database**), so
there is nothing to install beyond npm packages.

**Backend**
```
cd backend
cp .env.example .env     # first time only — then set JWT_SECRET
npm install
npm run migrate:up       # create the schema
npm run seed:admin       # create the first admin account
npm run dev              # http://localhost:5000
```

`JWT_SECRET` has no default and the server refuses to start without one —
signing tokens with `undefined` would be worse than failing loudly. Generate
one with:
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Frontend**
```
cd frontend
npm install
npm run dev              # http://localhost:5173
```
Vite proxies `/api/*` to the backend (`vite.config.js`), so there is no CORS
configuration in development.

**Check it is up:** `GET /api/health` returns
`{ status: "ok", database: "connected", dbTime: ... }`, round-tripping a real
query to PostgreSQL. The same endpoint is the deployment's health check.

### Demo data

`npm run seed:sample` fills in a small school — staff, sections, subjects and
learners. `npm run seed:demo-data` then drives grades and attendance through
the real endpoints to produce a believable term of history, including
learners who decline and recover.

**Never run either against a deployment holding real records.** They are for
a development machine and a defense demo.

---

## Tests

```
npm test                 # from the repo root: everything
```

That runs the pure-function risk-formula checks and then the integration
suite — 72 tests against the real Express app and a real database, not
mocks. They assume the development database is already running (the same
assumption the migrate and seed scripts make).

The suite covers the grade approval chain end to end, risk recalculation and
its trend boundaries, intervention auto-resolve and auto-escalate, the SF2
attendance importer, the performance bands, authentication and account
security, per-role record scoping, and school-year isolation.

`npx oxlint src` and `npm run build` in `frontend/` cover the frontend; the
production build is worth running before any push, since it minifies and
catches CSS the dev server tolerates.

---

## Layout

```
backend/
  config/       environment, database, and every threshold and constant
  controllers/  request handlers — one file per feature
  routes/       route definitions, mounted under /api
  models/       database queries — one file per entity
  services/     logic with no HTTP and (mostly) no database: the risk
                formula, the importers' parsers and validators, PDF/Excel
  middleware/   auth, role checks, uploads
  utils/        small shared helpers
  migrations/   schema history, applied with node-pg-migrate
  test/         integration suite
frontend/src/
  pages/        one per route
  components/   shared UI
  context/      auth and theme
  api/          the fetch wrapper every page uses
```

Each backend folder has its own `README.md` explaining what belongs in it and
how it connects to the others.

---

## Database

No system-wide PostgreSQL install was available when this project was set up,
so the backend runs a real PostgreSQL 18 server out of `backend/.pgdata` via
the `embedded-postgres` npm package (`backend/config/embeddedPostgres.js`),
controlled by `USE_EMBEDDED_DB`. It is a genuine PostgreSQL instance, not an
in-memory substitute — all SQL and `pg` usage works unchanged against any
other PostgreSQL server.

**To point at a hosted or school server instead:** set
`USE_EMBEDDED_DB=false` and fill in `PGHOST` / `PGPORT` / `PGUSER` /
`PGPASSWORD` / `PGDATABASE` in `.env`. No code changes — `config/db.js` has
always read those same variables.

Schema changes are migrations, never hand-edited tables:
```
npm run migrate:create -- add-something   # new migration file
npm run migrate:up                        # apply
npm run migrate:down                      # roll back the last one
```
The deployment runs `migrate:up` automatically before each release.
