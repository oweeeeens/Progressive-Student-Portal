-- Up Migration

-- Enrollment now happens on paper before a student's record is ever added
-- here (see CLAUDE.md's "REMOVED: Enrollment Management") — by the time a
-- registrar is creating this row, the student has already enrolled, so
-- 'pending' is no longer the right default. 'pending' stays a valid,
-- selectable value (studentModel's UPDATABLE_FIELDS/the student form's
-- dropdown both still offer it) for the rare case a record is entered
-- ahead of paperwork being finalized — only the default changes, existing
-- rows are untouched.
ALTER TABLE students ALTER COLUMN enrollment_status SET DEFAULT 'enrolled';

-- Down Migration

ALTER TABLE students ALTER COLUMN enrollment_status SET DEFAULT 'pending';
