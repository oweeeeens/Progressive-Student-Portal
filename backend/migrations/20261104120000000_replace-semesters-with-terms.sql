-- Up Migration

-- The school year is three TERMS. It is not two semesters.
--
-- Confirmed by the school on 2026-11-04: a Grade 11 subject runs all three
-- terms; a Grade 12 subject changes EVERY TERM; a specialized subject runs
-- all three terms in both grade levels.
--
-- The schema said something subtly different, and the difference came from
-- one word. The client said a Grade 12 subject changes each "term", and
-- "term" was read as "semester". So `class_offerings.term` offered 'sem1'
-- and 'sem2', and `grading_periods.semester` had to exist to say which of
-- the three periods belonged to which of the two semesters — a mapping that
-- was only ever necessary because three terms were being squeezed into two.
--
-- With an offering naming its term directly, there is nothing left to map.
-- This migration is therefore a SIMPLIFICATION: one column goes away and a
-- whole fail-open rule ("a period with no semester assigned is treated as
-- covered") stops being needed, because there is no longer anything that can
-- be left unset.

-- 1. Every offering that named a semester widens to the whole year.
--
-- THIS IS THE JUDGEMENT CALL IN THIS FILE, so it is worth stating plainly.
-- A 'sem1' offering covered TWO periods. A single term cannot express that,
-- and splitting the row in two would orphan every grade pointing at its
-- class_offering_id. The remaining choices are to widen (the class shows in
-- every term) or to narrow (the class shows in one, and its grades in the
-- others become invisible).
--
-- It widens. Nothing recorded can disappear from a learner's grade view
-- because of a migration — that is the same fail-open reasoning behind
-- DEFAULT 'full_year' when the column was first added. The admin then
-- narrows the Grade 12 classes on the Class Offerings page, where the term
-- is already a visible column and an editable field.
--
-- Runs BEFORE the CHECK is swapped, so it is valid under the old constraint.
UPDATE class_offerings SET term = 'full_year' WHERE term <> 'full_year';

-- 2. The term vocabulary itself.
ALTER TABLE class_offerings DROP CONSTRAINT class_offerings_term_check;

ALTER TABLE class_offerings
  ADD CONSTRAINT class_offerings_term_check
  CHECK (term IN ('full_year', 'term1', 'term2', 'term3'));

COMMENT ON COLUMN class_offerings.term IS
  'How long this class runs: the whole school year, or exactly one of the three terms. A term maps to a grading period by sequence_number (see backend/config/academicTerms.js).';

-- class_offerings_subject_section_year_term_key is deliberately untouched.
-- It already includes `term`, and "the same subject to one section once per
-- term" is exactly the right uniqueness under this model too — a Grade 12
-- subject legitimately IS offered to one section more than once in a year.

-- 3. The semester column, which now has no job.
ALTER TABLE grading_periods DROP COLUMN semester;

-- Down Migration

-- Restores the shape, NOT the data, and the difference is worth being
-- honest about: which period belonged to which semester cannot be recovered
-- once the column is dropped. That is three rows per school year, re-entered
-- through the Academic Setup form in under a minute — which is why dropping
-- it outright was acceptable in the first place.
ALTER TABLE grading_periods
  ADD COLUMN semester SMALLINT CHECK (semester IN (1, 2));

COMMENT ON COLUMN grading_periods.semester IS
  'Which semester this period falls in (1 or 2), set by the admin. NULL until assigned.';

-- Every term-bound class widens back to the whole year, for the same reason
-- the up migration widened: a rollback must not be able to hide a grade
-- either. 'term2' in particular has no semester equivalent at all.
UPDATE class_offerings SET term = 'full_year' WHERE term <> 'full_year';

ALTER TABLE class_offerings DROP CONSTRAINT class_offerings_term_check;

ALTER TABLE class_offerings
  ADD CONSTRAINT class_offerings_term_check
  CHECK (term IN ('full_year', 'sem1', 'sem2'));

COMMENT ON COLUMN class_offerings.term IS
  'How long this class runs: the whole school year, or one semester. Which quarters that covers is decided by grading_periods.semester.';
