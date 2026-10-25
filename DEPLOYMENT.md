# Deploying the Student Portal to Railway

This guide takes the project from a local development setup to a running
deployment on [Railway](https://railway.com). Nothing here changes how local
development works: every setting below is unset or `false` on your machine, so
`npm run dev` behaves exactly as it always has.

## What gets deployed

Two services in one Railway project:

| Service | What it is |
| --- | --- |
| **Postgres** | Railway's managed PostgreSQL. Replaces the `embedded-postgres` used for local development. |
| **Student Portal** | This repository. One Node process that serves **both** the Express API and the built React frontend. |

The frontend and API are deliberately **one service on one origin**. The
frontend calls `/api/...` with no hostname (see `frontend/src/api/client.js`),
which only works if both are served from the same place — and one service
instead of two roughly halves the hosting bill, since Railway charges per
service for memory and CPU.

## Before you start

1. Push the repository to GitHub — Railway deploys from a Git repo.
2. Have a Railway account on the **Hobby** plan ($5/month, which includes $5 of
   usage credit).

## 1. Create the project and the database

1. **New Project → Deploy PostgreSQL**. Railway creates the database and a set
   of connection variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
   `PGDATABASE`, `DATABASE_URL`).
2. Leave it alone for now; the app service will reference those variables.

## 2. Create the app service

1. **New → GitHub Repo** and pick this repository.
2. Railway reads `railway.json` at the repo root, which sets:
   - **Build command** — `npm run build`
     (installs and builds the frontend, then installs backend production
     dependencies)
   - **Start command** — `npm start`
   - **Pre-deploy command** — `npm run migrate:up` (runs database migrations
     before each new version goes live)
   - **Health check** — `/api/health`, which confirms both Express *and* the
     database connection, so a deploy that cannot reach Postgres fails instead
     of going live broken.

> **Note:** Railway has deprecated `railway.json` ("Config as Code") for new
> setups, with existing files honoured until **1 December 2026**. If it is
> ignored, set the same four values by hand in the service's **Settings →
> Build / Deploy** panels. The values are the ones listed above.

## 3. Set the environment variables

On the **Student Portal** service → **Variables**. For the five `PG*` values,
use Railway's variable references so they track the database service
automatically (type `${{` in the value field to pick them).

| Variable | Value | Why |
| --- | --- | --- |
| `USE_EMBEDDED_DB` | `false` | Use the real database instead of starting a local one. |
| `PGHOST` | `${{Postgres.PGHOST}}` | Private network host (`*.railway.internal`). |
| `PGPORT` | `${{Postgres.PGPORT}}` | |
| `PGUSER` | `${{Postgres.PGUSER}}` | |
| `PGPASSWORD` | `${{Postgres.PGPASSWORD}}` | |
| `PGDATABASE` | `${{Postgres.PGDATABASE}}` | |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Used by the migration tool only. |
| `JWT_SECRET` | a long random string | Signs login tokens. **The app refuses to start without it.** Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `JWT_EXPIRES_IN` | `8h` | A school day. |
| `SERVE_FRONTEND` | `true` | Makes Express serve the built frontend. |
| `UPLOADS_ROOT` | `/data` | Must match the volume mount path in step 4. |
| `FRONTEND_URL` | the service's public URL | Used to build password-reset links. Fill in after Railway assigns the domain. |
| `ADMIN_EMAIL` | the school's admin address | Used once, by `seed:admin`. |
| `ADMIN_PASSWORD` | a strong password | Used once. Change it after the first login. |
| `ADMIN_FULL_NAME` | e.g. `System Administrator` | Used once. |
| `RESEND_API_KEY` | *(optional)* | Enables "Forgot password". Leave unset and the portal says so plainly instead of pretending — see "Email" below. |
| `RESEND_FROM_EMAIL` | `onboarding@resend.dev` | Only used when a key is set. |

Do **not** set `PGSSLMODE` while using the private `PGHOST` above — that
network carries no TLS and needs none. Set it to `require` only if you ever
connect over a public proxy host.

Do **not** set `DEV_PLACEHOLDER_PASSWORD` on a deployment: it gives every newly
created account the same known password.

## 4. Add a volume for uploaded files

Announcement attachments are written to disk, and a deployed container's
filesystem **is wiped on every redeploy**. Without a volume, every attachment
disappears the next time you push.

1. On the Student Portal service: **Settings → Volumes → Add volume**.
2. Mount path: `/data`. Size: 1 GB is plenty (Hobby allows up to 5 GB).
3. Confirm `UPLOADS_ROOT=/data` is set (step 3). The app creates
   `/data/announcements` itself on first use.

## 5. First deploy

1. Deploy. The pre-deploy step runs the migrations, so the schema is created
   automatically — there is nothing to import by hand.
2. Create the first admin account, once, from the service's **command /
   shell**:

   ```bash
   npm run seed:admin
   ```

   It reads `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_FULL_NAME`, and does
   nothing if that account already exists.
3. Under **Settings → Networking**, generate a public domain, then set
   `FRONTEND_URL` to it so password-reset links point at the right place.

Every account after that is created inside the app: log in as the admin and use
**User Management → New Account**.

## 6. Check it worked

- `https://<your-domain>/api/health` returns
  `{"status":"ok","database":"connected",...}`.
- The login page loads at the domain root.
- Logging in as the admin lands on the dashboard.
- Opening a deep link directly — e.g. `https://<your-domain>/students` — loads
  the app rather than a 404. (This is the single-page-app fallback; if it
  fails, `SERVE_FRONTEND` is not set.)
- Posting an announcement with a PDF attachment, then redeploying, and the
  attachment still downloads. (This is the volume; if it fails, check the mount
  path and `UPLOADS_ROOT`.)

## Operating notes

**Cost.** Railway bills per second, roughly $10 per GB of memory per month and
$20 per vCPU per month, against the $5 of included credit. An idle API plus a
small database realistically lands around $5–10 a month if left running
continuously. **Stopped services cost nothing**, so for a capstone you can keep
the project stopped and start it for the defense and for your panel's testing.

## Demo data (for a defence or a walkthrough)

A fresh deployment has nothing in it but the admin account, which makes it
hard to show anything. Two scripts populate a complete, realistic school.
**Only do this on a demo deployment** — see the warnings below.

**Step 1 — structure (accounts, sections, subjects, students).** Temporarily
set the pre-deploy command to:

```
npm run migrate:up && npm run seed:sample
```

Deploy, wait for it to finish, then **change the pre-deploy command straight
back** to `npm run migrate:up && npm run seed:admin`. This matters:
`seed:sample` begins with `TRUNCATE school_years RESTART IDENTITY CASCADE`,
which deletes every section, student, grade and attendance record. Left in
the pre-deploy command, it would wipe the school on every future deploy.

**Step 2 — academic records (grades through the full approval chain, plus
attendance).** Run this from your own machine, pointed at the deployment:

```bash
cd backend
SEED_BASE_URL=https://your-app.up.railway.app npm run seed:demo-data
```

On Windows PowerShell:

```powershell
cd backend
$env:SEED_BASE_URL="https://your-app.up.railway.app"; npm run seed:demo-data
```

It drives the real API — submit, principal-verify, adviser-finalize, then
attendance — so every risk assessment is calculated exactly as live use
would calculate it. No database credentials needed; it signs in as the test
accounts over HTTPS.

### What this gives you

Six students across three sections, two graded quarters, daily and
per-subject attendance, and one student (Carlo Santos) deliberately at High
Risk so the Academic Progress Tracking and intervention views have something
to show.

Test logins, all with the password `Password123!`:

| Account | Role |
| --- | --- |
| `principal@studentportal.local` | Principal |
| `adviser@studentportal.local` | Adviser (STEM A) |
| `adviser2@studentportal.local` | Adviser (STEM B, ABM A) |
| `subject_teacher@studentportal.local` | Subject teacher |
| `student@studentportal.local` | Student (Carlo Santos) |

### Before the school uses this for real

- **Those passwords are published in this repository.** While the demo
  accounts exist on a public URL, anyone who finds the link can sign in as a
  teacher. Keep the service stopped except when demonstrating, or change the
  passwords from User Management.
- **The records are fictional.** Deactivate the demo accounts in User
  Management and re-run `seed:sample` once (which truncates the academic
  tables) before entering a single real student, so no invented grade is ever
  mistaken for a real one.
- Never run either script against a deployment that already holds real
  data.

**Email.** `RESEND_API_KEY` is what makes "Forgot password" work. Without it
the page says reset by email isn't set up and tells the user to ask their
adviser, the registrar or the ICT staff — who can issue a temporary password
from **User Management**, which is the fallback this project was designed
around. Nothing silently fails either way.

Do **not** set `EMAIL_DEV_FALLBACK` on a deployment: it is the developer
console fallback, and on a server it would write reset links into logs while
telling users the email was sent.

If you do add a Resend key, be aware that the shared `onboarding@resend.dev`
sender is intended for testing. Delivering to arbitrary recipients — your
students' personal addresses — normally requires verifying a sending domain,
which this school may not have. Send one test reset to a real student address
before relying on it in front of the panel.

**Database backups.** Railway's Postgres has its own backup settings. Turn them
on before the school enters real student data.

**If a build fails** with a lockfile error, it means `package.json` and
`package-lock.json` disagree in `frontend/`, `backend/`, or the repo root. Run
`npm install` in that folder, commit the updated lockfile, and redeploy.

## Moving to another host

Nothing in this setup is Railway-specific except `railway.json`. Any host that
can run a Node process, provide the environment variables above, and mount a
writable directory will work: set the same variables, run `npm run build`, then
`npm start`, and run the migrations before first boot.
