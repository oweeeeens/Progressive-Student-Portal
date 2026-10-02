-- Up Migration

-- Enrollment, sections, and grading periods are all scoped to a school year,
-- since a student's section/subjects/grades reset each year.
CREATE TABLE school_years (
  id SERIAL PRIMARY KEY,
  label VARCHAR(20) NOT NULL UNIQUE, -- e.g. '2025-2026'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE school_years;
