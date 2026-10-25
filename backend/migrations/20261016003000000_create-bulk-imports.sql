-- Up Migration

-- Audit trail for the bulk student import feature (who imported, when, how
-- many rows succeeded/failed, and what column mapping they used). The
-- mapping is also read back as the "remember my last mapping" default on
-- the next import — see models/bulkImportModel.js's getLastMapping. Uses
-- ON DELETE RESTRICT on performed_by, same reasoning as announcements.posted_by:
-- this is an institutional record worth keeping even if the staff account
-- that performed the import is later deactivated.
CREATE TABLE bulk_imports (
  id SERIAL PRIMARY KEY,
  performed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  file_name VARCHAR(255) NOT NULL,
  total_rows INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  column_mapping JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_bulk_imports_created_at ON bulk_imports(created_at DESC);

-- Down Migration

DROP TABLE bulk_imports;
