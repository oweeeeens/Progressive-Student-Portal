-- Up Migration

-- Narrows the System to its title (2026-11-11). The research adviser asked
-- the group to remove modules the title — a student portal with trend-based
-- academic risk analytics and an intervention monitoring dashboard — does
-- not cover. Three went:
--
--   1. Announcements, and with them the ICT Faculty role, whose only job was
--      to post them.
--   2. Subject-level attendance. It was supplementary by design and never fed
--      the risk score; only the adviser's daily (SF2) register does.
--   3. The printable report card (no table of its own — code only).
--
-- This is a deliberate, documented scope reduction, recorded the same way the
-- Enrollment removal was (see CLAUDE.md).

DROP TABLE subject_attendance_records;
DROP TABLE announcements;

-- The audit rows of subject-attendance imports describe writes into a table
-- that no longer exists. Daily imports are untouched: their rows are still
-- referenced by daily_attendance_records.import_id.
DELETE FROM bulk_imports WHERE import_type = 'attendance_subject';

-- The 'ict_faculty' value stays in the user_role enum: Postgres cannot drop an
-- enum value without rebuilding the type and every column that uses it, which
-- is a lot of risk for no behaviour. Instead every such account is switched
-- off — authMiddleware re-checks is_active on every request, so access ends at
-- once — and config/auth.js no longer lists the role, so none can be created.
-- The accounts themselves are kept, as every deactivated account is.
UPDATE users SET is_active = FALSE, updated_at = now() WHERE role = 'ict_faculty';

-- Down Migration

-- Restores the two tables EMPTY. What was in them is not recoverable from
-- this migration, and the ICT accounts stay deactivated (there is no record
-- of which ones were active before) — reactivate them by hand if needed.

CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  file_path VARCHAR(500),
  original_filename VARCHAR(255),
  posted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_announcements_created_at ON announcements(created_at DESC);

CREATE TABLE subject_attendance_records (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  class_offering_id INTEGER NOT NULL REFERENCES class_offerings(id) ON DELETE RESTRICT,
  grading_period_id INTEGER NOT NULL REFERENCES grading_periods(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status attendance_status NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  import_id INTEGER NULL REFERENCES bulk_imports(id) ON DELETE RESTRICT,
  UNIQUE (student_id, class_offering_id, attendance_date)
);
CREATE INDEX idx_subject_attendance_student_id ON subject_attendance_records(student_id);
CREATE INDEX idx_subject_attendance_class_offering_id ON subject_attendance_records(class_offering_id);
CREATE INDEX idx_subject_attendance_import_id ON subject_attendance_records(import_id);
