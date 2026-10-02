-- Up Migration

-- One quarterly grade per student per subject. DepEd's transmuted grading
-- scale runs 60-100; a grade below 75 is DepEd's at-risk threshold (used by
-- the risk formula in config/riskConfig.js, not hardcoded here).
CREATE TABLE grades (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  class_offering_id INTEGER NOT NULL REFERENCES class_offerings(id) ON DELETE RESTRICT,
  grading_period_id INTEGER NOT NULL REFERENCES grading_periods(id) ON DELETE RESTRICT,
  grade_value NUMERIC(5,2) NOT NULL CHECK (grade_value BETWEEN 60 AND 100),
  recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (student_id, class_offering_id, grading_period_id)
);

CREATE INDEX idx_grades_student_id ON grades(student_id);

-- Down Migration

DROP TABLE grades;
