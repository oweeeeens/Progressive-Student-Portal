-- Up Migration

-- Which bulk import, if any, wrote this attendance row.
--
-- The grid importer deliberately reuses the marking sheets' own upsert, so
-- until now an imported mark was byte-for-byte indistinguishable from one an
-- adviser entered by hand. For ordinary data that is fine; for the official
-- DepEd daily register it is not, because the importer is the one feature
-- that can rewrite a whole month in a single action and neither attendance
-- table carries an updated_at to show it happened.
--
-- NULL means "entered by hand", which is true of every row that exists
-- today, so nothing needs backfilling. ON DELETE RESTRICT matches every
-- other foreign key in this schema and is right here too: bulk_imports is an
-- institutional audit record, and a row pointing at a deleted import would
-- be worse than no pointer at all.
ALTER TABLE daily_attendance_records
  ADD COLUMN import_id INTEGER NULL REFERENCES bulk_imports(id) ON DELETE RESTRICT;

ALTER TABLE subject_attendance_records
  ADD COLUMN import_id INTEGER NULL REFERENCES bulk_imports(id) ON DELETE RESTRICT;

-- Answers "every row this import wrote" cheaply — for an audit question now,
-- and for undoing an import later without another migration.
CREATE INDEX idx_daily_attendance_import_id ON daily_attendance_records(import_id);
CREATE INDEX idx_subject_attendance_import_id ON subject_attendance_records(import_id);

-- Down Migration

DROP INDEX idx_subject_attendance_import_id;
DROP INDEX idx_daily_attendance_import_id;
ALTER TABLE subject_attendance_records DROP COLUMN import_id;
ALTER TABLE daily_attendance_records DROP COLUMN import_id;
