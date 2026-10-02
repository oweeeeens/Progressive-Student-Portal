-- Up Migration

-- "This teacher teaches this subject to this section this school year."
-- Grades reference this (not subject/section/teacher directly) so a subject
-- teacher's access to a grade can be checked via a single teacher_id lookup.
CREATE TABLE class_offerings (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (subject_id, section_id, school_year_id)
);

CREATE INDEX idx_class_offerings_teacher_id ON class_offerings(teacher_id);
CREATE INDEX idx_class_offerings_section_id ON class_offerings(section_id);

-- Down Migration

DROP TABLE class_offerings;
