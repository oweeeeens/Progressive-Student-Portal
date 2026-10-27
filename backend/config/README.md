# `config/` — every threshold and constant, in one place

Data, not logic. If a number matters — a risk threshold, a file size limit,
a rate limit, the set of valid roles — it is written down here exactly once
and imported everywhere else.

CLAUDE.md asks for this explicitly, and the reason is practical: during a
defense, "where does 75 come from?" should be answerable by opening one file.

## Reading from the environment

Anything overridable goes through `utils/envNumber.js`, which falls back to
the shipped default and **warns** on a malformed value. The alternative,
`Number(process.env.X)`, yields `NaN` on a typo — and every comparison
against `NaN` is false, so a mistyped threshold does not merely use a wrong
number, it switches the check off entirely with nothing logged.

The defaults are the production values. An unset or malformed variable gives
the strict setting, never the permissive one.

## The files

- **`riskConfig.js`** — the formula: the 75 passing mark, the −5 trend
  thresholds, 2 points per factor, the 0–2 / 3–5 / 6+ bands. Also
  `ATTENDANCE_RISK_THRESHOLD`, the one value still pending from the client,
  overridable by env var and defaulting to 90.
- **`academicProgress.js`** — the three bands and the fixed advisory text,
  with a separate student-facing set written in plain language.
- **`auth.js`** — roles, `CREATABLE_ROLES` (never `admin`), token lifetime,
  and the `JWT_SECRET` check that refuses to start without one.
- **`environment.js`** — `IS_PRODUCTION`, and `devOnlyFlag`, which refuses a
  development-only override on a real deployment and says so at boot.
- **`learnerStatus.js`** — which roles may see each of the three DepEd
  reporting fields. Per field, not one blanket rule: a teacher may know a
  learner has a disability, not that the household receives 4Ps.
- **`rateLimits.js`**, **`bulkImport.js`**, **`attendanceImport.js`**,
  **`announcements.js`** — limits and vocabularies for their features.
- **`db.js`** — the pool, plus a type parser that keeps `DATE` columns as
  plain `YYYY-MM-DD` strings. Letting them become JavaScript `Date` objects
  shifts them by a timezone, which is a whole class of off-by-one-day bug
  this app does not have.
