-- Up Migration

-- Scope is digital document upload only (no payment/fee tables needed).
-- Files themselves live on disk/cloud storage; only the path is stored here.
CREATE TYPE enrollment_document_type AS ENUM (
  'report_card',
  'birth_certificate',
  'sf10',
  'other'
);

CREATE TYPE enrollment_document_status AS ENUM (
  'pending',
  'verified',
  'rejected'
);

CREATE TABLE enrollment_documents (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  document_type enrollment_document_type NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  status enrollment_document_status NOT NULL DEFAULT 'pending',
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMP,
  uploaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrollment_documents_student_id ON enrollment_documents(student_id);

-- Down Migration

DROP TABLE enrollment_documents;
DROP TYPE enrollment_document_status;
DROP TYPE enrollment_document_type;
