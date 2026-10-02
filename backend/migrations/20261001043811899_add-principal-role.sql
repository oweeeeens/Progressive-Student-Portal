-- Up Migration

-- New role: accounts for the school principal can now be created via the
-- staff account creation flow (admin/registrar only — see authController.js).
ALTER TYPE user_role ADD VALUE 'principal';

-- Down Migration

-- Postgres does not support removing a single value from an enum type
-- directly (would require recreating the type and every column/constraint
-- that uses it). Left as a documented no-op rather than a destructive
-- rebuild — if this ever needs to be undone, drop any 'principal' rows
-- first, then recreate user_role from scratch in a follow-up migration.
