-- Up Migration

-- One row per login. role drives what a user can see/do (advisers see only
-- their own advisory section, subject teachers only their own classes, etc.)
-- Enforced in the application layer, not by Postgres row-level security.
CREATE TYPE user_role AS ENUM (
  'admin',
  'adviser',
  'subject_teacher',
  'guidance_counselor',
  'registrar',
  'student'
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE users;
DROP TYPE user_role;
