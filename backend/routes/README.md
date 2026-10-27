# `routes/` — URL to handler

Thin by design: a route file maps paths to controller functions and mounts
middleware. No logic. Every router is mounted under `/api` in `app.js`.

## Middleware order

`requireAuth` first, always. Then `requireRole` only where a role is the real
boundary.

Several routers deliberately carry **no** role middleware — the attendance
routers and the attendance importer among them. That is not an oversight:
write access there depends on `sections.adviser_id` or
`class_offerings.teacher_id`, which the route cannot know. The controller
checks it per request. Where a router does skip role middleware, its header
comment says why.

A file upload is a side effect, so the role check goes *before* multer, not
after — otherwise an unauthorized request has already written to disk by the
time it is refused.

## Rate limiting

`/auth/login`, `/auth/forgot-password` and `/auth/reset-password` are
limited (`config/rateLimits.js`). The defaults are the production values: a
missing or malformed environment variable gives the strict limit, never an
open door.
