-- Up Migration

-- One snapshot per student per grading period. Recalculated whenever new
-- grades/attendance are entered for that period (not real-time) — see
-- riskCalculator.js. interventions references this table to capture the
-- risk level a student was at when an intervention was logged.
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');

CREATE TABLE risk_assessments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  grading_period_id INTEGER NOT NULL REFERENCES grading_periods(id) ON DELETE RESTRICT,
  average_grade NUMERIC(5,2),
  grade_trend NUMERIC(6,3), -- change in average grade per period
  attendance_rate NUMERIC(5,2),
  attendance_trend NUMERIC(6,3), -- change in attendance rate per period
  risk_score SMALLINT NOT NULL,
  risk_level risk_level NOT NULL,
  calculated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (student_id, grading_period_id)
);

CREATE INDEX idx_risk_assessments_student_id ON risk_assessments(student_id);

-- Down Migration

DROP TABLE risk_assessments;
DROP TYPE risk_level;
