-- Up Migration

-- CLAUDE.md's confirmed grade approval workflow is 3 stages: subject teacher
-- submits -> principal verifies (or rejects, with a note, sending it back to
-- the teacher) -> adviser finalizes. The original grades migration only
-- implemented 2 stages (draft -> finalized), with no principal step. Rename
-- 'draft' to 'submitted' (same meaning — a teacher's unreviewed entry — so
-- existing rows transition cleanly with no data migration needed) rather than
-- adding a parallel value, then add the two new states the principal's
-- review introduces.
ALTER TYPE grade_status RENAME VALUE 'draft' TO 'submitted';
ALTER TYPE grade_status ADD VALUE 'principal_verified';
ALTER TYPE grade_status ADD VALUE 'rejected';

-- Mirrors the existing finalized_by/finalized_at pair, one step earlier in
-- the chain.
ALTER TABLE grades ADD COLUMN verified_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE grades ADD COLUMN verified_at TIMESTAMP;

-- A rejection is a distinct outcome from verification, not just "verified by
-- someone else" — kept as its own by/at pair plus the note the principal
-- must leave, which the subject teacher needs to see to know what to fix.
ALTER TABLE grades ADD COLUMN rejected_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE grades ADD COLUMN rejected_at TIMESTAMP;
ALTER TABLE grades ADD COLUMN rejection_note TEXT;

-- Down Migration

-- Postgres does not support removing a single value from an enum type, or
-- renaming one back, without recreating the type and every column/constraint
-- that uses it (see add-principal-role.sql for the same tradeoff). Left as a
-- documented no-op; the new columns are harmless to leave in place.
