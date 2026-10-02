-- Up Migration

CREATE TYPE student_enrollment_status AS ENUM (
  'pending',
  'enrolled',
  'dropped',
  'transferred',
  'graduated'
);

CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE RESTRICT, -- set only if the student has a portal login
  lrn VARCHAR(12) NOT NULL UNIQUE, -- DepEd Learner Reference Number
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  sex CHAR(1) CHECK (sex IN ('M', 'F')),
  date_of_birth DATE NOT NULL,
  address TEXT,
  guardian_name VARCHAR(150),
  guardian_contact_number VARCHAR(20),
  current_section_id INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  enrollment_status student_enrollment_status NOT NULL DEFAULT 'pending',
  -- Soft-delete flag: schools keep academic records even for students who
  -- leave, so a student is deactivated rather than deleted. Every table that
  -- references students(id) stays intact when this is set to FALSE.
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_current_section_id ON students(current_section_id);

-- Down Migration

DROP TABLE students;
DROP TYPE student_enrollment_status;
