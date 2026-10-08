-- Up Migration

-- The client decided to keep their existing paper-based enrollment process
-- rather than digitizing it through the portal — see CLAUDE.md's "REMOVED:
-- Enrollment Management" section. This drops exactly what the original
-- 20261001020246575_create-enrollment-documents.sql migration (plus its
-- later 20261001033457037_add-review-note-to-enrollment-documents.sql
-- column addition) created. students.enrollment_status and its enum are
-- NOT touched here — that column is core Student Records functionality
-- (status filter/sort, stat cards, the manual dropdown in the student
-- form), not enrollment-document-specific, and survives this removal as
-- the registrar's manual way to mark a student 'enrolled' after processing
-- their paperwork off-system.
DROP TABLE enrollment_documents;
DROP TYPE enrollment_document_status;
DROP TYPE enrollment_document_type;

-- Down Migration

-- Recreates the table/enums exactly as they were (including the review_note
-- column from the later migration, folded in here since there's no
-- intermediate state to restore separately) — but any uploaded files and
-- document rows that existed before the Up migration ran are gone for good;
-- this only restores the schema, not the data.
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
  uploaded_at TIMESTAMP NOT NULL DEFAULT now(),
  review_note TEXT
);

CREATE INDEX idx_enrollment_documents_student_id ON enrollment_documents(student_id);
