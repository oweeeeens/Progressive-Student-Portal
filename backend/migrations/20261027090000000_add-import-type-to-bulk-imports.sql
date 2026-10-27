-- Up Migration

-- The attendance grid importer logs to this same audit table, so a row now
-- has to say WHICH importer wrote it. Without this column the attendance
-- imports' symbol maps would be read back as the student importer's
-- "remember my last mapping" default (see bulkImportModel.getLastMapping) —
-- two completely different shapes of mapping in one table.
--
-- Defaults to 'students' so every row already in the table, all of which
-- came from the student importer, keeps the right label.
ALTER TABLE bulk_imports
  ADD COLUMN import_type VARCHAR(32) NOT NULL DEFAULT 'students';

-- getLastMapping filters by import_type and takes the newest row, so the
-- index that serves it covers both columns.
CREATE INDEX idx_bulk_imports_type_created_at ON bulk_imports(import_type, created_at DESC);

-- Down Migration

DROP INDEX idx_bulk_imports_type_created_at;
ALTER TABLE bulk_imports DROP COLUMN import_type;
