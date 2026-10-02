-- Up Migration

-- An advisory class (e.g. "Grade 11 - STEM A"). adviser_id is what scopes an
-- adviser to only their own students throughout the app.
CREATE TABLE sections (
  id SERIAL PRIMARY KEY,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level SMALLINT NOT NULL CHECK (grade_level IN (11, 12)),
  strand VARCHAR(20), -- STEM / ABM / HUMSS / GAS / TVL, nullable until assigned
  name VARCHAR(50) NOT NULL, -- e.g. 'STEM A'
  adviser_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (school_year_id, grade_level, name)
);

CREATE INDEX idx_sections_adviser_id ON sections(adviser_id);

-- Down Migration

DROP TABLE sections;
