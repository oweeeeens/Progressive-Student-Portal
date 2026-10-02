-- Up Migration

-- The adviser's official daily/homeroom attendance register (DepEd's SF2).
-- One row per student per day, independent of subject_attendance_records.
-- This is the record the risk formula's "attendance rate" is calculated
-- from (see riskCalculator.js) — subject-level attendance is each teacher's
-- own class record and does not feed the risk score directly.
CREATE TABLE daily_attendance_records (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  grading_period_id INTEGER NOT NULL REFERENCES grading_periods(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status attendance_status NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, -- normally the adviser; registrar may also correct
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (student_id, attendance_date)
);

CREATE INDEX idx_daily_attendance_student_id ON daily_attendance_records(student_id);

-- Down Migration

DROP TABLE daily_attendance_records;
