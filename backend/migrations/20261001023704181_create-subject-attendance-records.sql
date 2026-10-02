-- Up Migration

-- Per-subject/period attendance, logged by the subject teacher who owns the
-- class_offering (confirmed with client: each subject teacher tracks
-- attendance for their own class, separate from the adviser's daily
-- homeroom register — see daily_attendance_records).
CREATE TYPE attendance_status AS ENUM (
  'present',
  'absent',
  'late',
  'excused'
);

CREATE TABLE subject_attendance_records (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  class_offering_id INTEGER NOT NULL REFERENCES class_offerings(id) ON DELETE RESTRICT,
  grading_period_id INTEGER NOT NULL REFERENCES grading_periods(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status attendance_status NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, -- the subject teacher for that class_offering
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (student_id, class_offering_id, attendance_date)
);

CREATE INDEX idx_subject_attendance_student_id ON subject_attendance_records(student_id);
CREATE INDEX idx_subject_attendance_class_offering_id ON subject_attendance_records(class_offering_id);

-- Down Migration

DROP TABLE subject_attendance_records;
DROP TYPE attendance_status;
