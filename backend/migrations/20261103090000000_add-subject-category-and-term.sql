-- Up Migration

-- Lets the schema say which subjects run for how long.
--
-- The school's actual timetable, as the client describes it: a Grade 11
-- subject runs for all three quarters of the year. A Grade 12 subject
-- changes every semester — EXCEPT a specialized subject, which runs the
-- whole year in both grade levels. None of that could be recorded until now:
-- a class_offering was simply "this subject, to this section, this year",
-- with no way to say it stops at the end of the first semester, and a
-- subject had no type at all.
--
-- Three columns, each answering one question.

-- 1. What KIND of subject is this?
--
-- DepEd's own grouping for Senior High: core subjects every learner takes,
-- applied subjects, and specialized subjects belonging to the strand. It
-- existed in the codebase only as an unpersisted `strands: []` array in the
-- seed script.
--
-- 'core' as the default because it is the largest group and the safest
-- reading of an existing row: every subject already in the table was created
-- before this distinction existed, so none of them is knowingly specialized,
-- and specialized is the category that would change behaviour.
ALTER TABLE subjects
  ADD COLUMN category VARCHAR(12) NOT NULL DEFAULT 'core'
  CHECK (category IN ('core', 'applied', 'specialized'));

COMMENT ON COLUMN subjects.category IS
  'DepEd SHS subject grouping. Specialized subjects run the full year in both grade levels; core and applied follow the class offering''s term.';

-- 2. Which SEMESTER does this quarter belong to?
--
-- Nullable, and set by the admin per quarter in Academic Setup — not
-- derived. Three quarters do not divide into two semesters, so there is no
-- arithmetic that produces this; only the school knows where their semester
-- boundary falls. Existing rows are left NULL rather than guessed at, which
-- is safe because every existing offering is 'full_year' (below) and a
-- full-year offering ignores this column entirely.
ALTER TABLE grading_periods
  ADD COLUMN semester SMALLINT CHECK (semester IN (1, 2));

COMMENT ON COLUMN grading_periods.semester IS
  'Which semester this quarter falls in (1 or 2), set by the admin. NULL until assigned. Cannot be derived — three quarters do not divide evenly into two semesters.';

-- 3. How long does THIS class run?
--
-- An enum, not a nullable `semester` column, and the reason is a real
-- constraint bug waiting to happen: Postgres treats NULLs as DISTINCT in a
-- UNIQUE, so a nullable column meaning "whole year" would silently permit
-- two whole-year rows for the same subject and section — exactly the
-- duplicate the UNIQUE below exists to prevent.
--
-- DEFAULT 'full_year' matches what every existing row means: Grade 11
-- subjects run all year, and that is all this database currently holds.
ALTER TABLE class_offerings
  ADD COLUMN term VARCHAR(10) NOT NULL DEFAULT 'full_year'
  CHECK (term IN ('full_year', 'sem1', 'sem2'));

COMMENT ON COLUMN class_offerings.term IS
  'How long this class runs: the whole school year, or one semester. Which quarters that covers is decided by grading_periods.semester.';

-- The same subject CAN now legitimately be offered to the same section twice
-- in one year — once per semester, which is exactly what a Grade 12 core
-- subject taught by different teachers across the two semesters looks like.
-- So the uniqueness that stops accidental duplicates has to include the term.
ALTER TABLE class_offerings
  DROP CONSTRAINT class_offerings_subject_id_section_id_school_year_id_key;

ALTER TABLE class_offerings
  ADD CONSTRAINT class_offerings_subject_section_year_term_key
  UNIQUE (subject_id, section_id, school_year_id, term);

-- Down Migration

ALTER TABLE class_offerings
  DROP CONSTRAINT class_offerings_subject_section_year_term_key;

-- Reversing this is only safe while no section has the same subject twice in
-- one year, which is precisely what the new term column made possible. If a
-- rollback fails here, that is the reason, and the duplicate rows have to be
-- resolved by hand before the old constraint can come back.
ALTER TABLE class_offerings
  ADD CONSTRAINT class_offerings_subject_id_section_id_school_year_id_key
  UNIQUE (subject_id, section_id, school_year_id);

ALTER TABLE class_offerings DROP COLUMN term;
ALTER TABLE grading_periods DROP COLUMN semester;
ALTER TABLE subjects DROP COLUMN category;
