-- Up Migration

-- A quarter within a school year. sequence_number is what the trend formula
-- (Trend = (Most Recent - Earliest) / Number of Periods) iterates over, since
-- it needs a reliable chronological order independent of the period's name.
CREATE TABLE grading_periods (
  id SERIAL PRIMARY KEY,
  school_year_id INTEGER NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  name VARCHAR(20) NOT NULL, -- e.g. 'Q1'
  sequence_number SMALLINT NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (school_year_id, sequence_number)
);

-- Down Migration

DROP TABLE grading_periods;
