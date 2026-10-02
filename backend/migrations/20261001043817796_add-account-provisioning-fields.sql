-- Up Migration

-- Set on a user created with a system-generated temporary password (both
-- admin/registrar-created staff accounts and auto-created student accounts)
-- — enforced server-side in authMiddleware.js, not just a frontend redirect.
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- A student's personal email, captured during enrollment (students use
-- personal email, not a school account — see CLAUDE.md). This is what their
-- portal account gets auto-created with once enrollment_status reaches
-- 'enrolled' — see services/accountProvisioning.js.
ALTER TABLE students ADD COLUMN email VARCHAR(255) UNIQUE;

-- Down Migration

ALTER TABLE students DROP COLUMN email;
ALTER TABLE users DROP COLUMN must_change_password;
