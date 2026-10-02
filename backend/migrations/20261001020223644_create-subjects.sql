-- Up Migration

CREATE TABLE subjects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE,
  grade_level SMALLINT CHECK (grade_level IN (11, 12)), -- nullable if offered in both grade levels
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE subjects;
