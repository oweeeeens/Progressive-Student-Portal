-- Up Migration

-- Three descriptive learner-status flags the school needs for DepEd
-- reporting. Explicitly NOT inputs to the risk formula — see
-- services/riskCalculator.js, which reads only grades and attendance.
-- They describe a learner's circumstances, not their academic performance,
-- and feeding them into a risk score would turn a reporting attribute into
-- a reason a student gets flagged.
--
-- NOT NULL DEFAULT FALSE rather than nullable: "we have not recorded this"
-- and "no" are the same thing for a reporting checkbox, and a nullable
-- boolean would mean every consumer has to handle three states.
ALTER TABLE students
  -- From the school's Student Information template, column
  -- "Is the learner a person with disability (PWD)".
  ADD COLUMN is_pwd BOOLEAN NOT NULL DEFAULT FALSE,
  -- From the same template, column "4Ps Recipient" (Pantawid Pamilyang
  -- Pilipino Program). Narrower visibility than the other two — household
  -- financial-assistance status is not something a subject teacher needs.
  ADD COLUMN is_4ps BOOLEAN NOT NULL DEFAULT FALSE,
  -- Alternative Learning System graduate. NOT in the template; set
  -- manually, or pre-filled on bulk import by matching "ALS" in the
  -- free-text "Last School Attended" column — which is why an imported
  -- value is always flagged for confirmation rather than trusted.
  ADD COLUMN is_als_graduate BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial indexes: these are reporting filters ("pull every PWD learner"),
-- and the TRUE rows are the small minority being searched for, so indexing
-- only those keeps the index small while still serving the query.
CREATE INDEX idx_students_is_pwd ON students(is_pwd) WHERE is_pwd = TRUE;
CREATE INDEX idx_students_is_4ps ON students(is_4ps) WHERE is_4ps = TRUE;
CREATE INDEX idx_students_is_als_graduate ON students(is_als_graduate) WHERE is_als_graduate = TRUE;

-- Down Migration

DROP INDEX IF EXISTS idx_students_is_als_graduate;
DROP INDEX IF EXISTS idx_students_is_4ps;
DROP INDEX IF EXISTS idx_students_is_pwd;

ALTER TABLE students
  DROP COLUMN is_als_graduate,
  DROP COLUMN is_4ps,
  DROP COLUMN is_pwd;
