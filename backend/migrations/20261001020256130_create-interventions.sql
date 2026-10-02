-- Up Migration

-- Logged against a specific risk_assessment (not just a student) so the
-- "risk level at time of intervention" is captured permanently. The next
-- grading period's recalculation compares its new risk_assessments row for
-- the same student against this one to auto-resolve/escalate the status.
CREATE TYPE intervention_type AS ENUM (
  'parent_conference',
  'tutoring_referral',
  'counseling_referral',
  'attendance_follow_up',
  'other'
);

CREATE TYPE intervention_status AS ENUM (
  'open',
  'monitoring',
  'resolved',
  'escalated'
);

CREATE TABLE interventions (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  risk_assessment_id INTEGER NOT NULL REFERENCES risk_assessments(id) ON DELETE RESTRICT,
  logged_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  intervention_type intervention_type NOT NULL,
  notes TEXT,
  status intervention_status NOT NULL DEFAULT 'open',
  date_logged DATE NOT NULL DEFAULT CURRENT_DATE,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_interventions_student_id ON interventions(student_id);

-- Down Migration

DROP TABLE interventions;
DROP TYPE intervention_status;
DROP TYPE intervention_type;
