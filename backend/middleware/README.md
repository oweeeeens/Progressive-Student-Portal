# `middleware/` — what runs before a handler

## `authMiddleware.js`

`requireAuth` verifies the token and then **re-reads the user from the
database on every request**. It does not trust the token's contents beyond
the id, which is what makes deactivation take effect immediately rather than
whenever the token happens to expire.

It also enforces the forced password change: an account still on its
temporary password is blocked everywhere except `/api/auth/*`, which is what
it needs to fix itself.

`requireRole` is a plain allowlist. It is the right tool only where a role
genuinely is the boundary — see `controllers/README.md` for why most access
checks are about assignment instead.

## `loadScopedStudent.js`

Resolves `:studentId` through `studentModel.findById`, which applies the
per-role scope clause. A student outside the caller's scope comes back as
404, not 403 — a 403 would confirm the id exists.

## Upload middleware

`bulkImportUploadMiddleware` (5 MB, `.xlsx`, memory). It sets a size limit
and a type filter, and the file is parsed from memory and discarded — never
written to disk. (An announcement-attachment upload, written to disk under a
generated name, existed until Announcements was removed on 2026-11-11.)

The import upload is memory-backed because the file is parsed and discarded
— there is nothing to clean up afterwards.
