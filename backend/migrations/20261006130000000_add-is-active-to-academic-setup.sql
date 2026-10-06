-- Up Migration

-- Sections, subjects, and class offerings can accumulate real grades and
-- attendance history over a school year — hard-deleting one (or allowing it
-- at all) would either cascade-destroy that history or be blocked outright
-- by the existing ON DELETE RESTRICT foreign keys. Deactivating instead
-- (same soft-delete pattern already used on students, see
-- 20261001020237082_create-students.sql) keeps the row and everything that
-- references it intact, while hiding it from pickers used to create NEW
-- records (new students assigned to a section, new class offerings for a
-- subject, etc). School years and grading periods are deliberately left
-- without this column — a school year isn't "deactivated," the school just
-- moves on to a new current one (see school_years.is_current), and the
-- existing ON DELETE RESTRICT on every table referencing them already
-- prevents accidental removal.
ALTER TABLE sections ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE subjects ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE class_offerings ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Down Migration

ALTER TABLE sections DROP COLUMN is_active;
ALTER TABLE subjects DROP COLUMN is_active;
ALTER TABLE class_offerings DROP COLUMN is_active;
