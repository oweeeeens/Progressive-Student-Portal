-- Up Migration

-- The Class Record: grades are computed from recorded scores, never typed.
--
-- Until now a subject teacher entered a learner's final term grade (60–100)
-- directly. The research adviser's objection, and DepEd's own rule, is that
-- a grade is the RESULT of a computation over the learner's scores —
-- DepEd Order No. 015, s. 2026, Annex D: total the raw scores per component,
-- turn them into percentages, weight them, add them, transmute. So the
-- System now stores the scores and the items they were earned on, and the
-- grade is derived from them (services/gradeCalculator.js).
--
-- The `grades` table stays the official record and the approval chain is
-- untouched: a computed term grade is submitted into it exactly as a typed
-- one used to be, and only a finalized grade feeds the risk formula.

-- 1. Which DepEd weight set a subject is graded by.
--
-- DO 015 Annex D, Table 2 gives Senior High seven groups with different
-- Written Works / Performance Tasks / Examinations splits (config/
-- gradingPolicy.js). The group cannot be derived from `category`
-- (core/applied/specialized is the older DO 8 grouping, kept because it
-- decides how long a subject runs), so it is its own column. Existing rows:
-- core subjects are core; everything else starts as an academic elective
-- (20/50/30, the same split as core) and the admin re-assigns TechPro,
-- Arts/Sports, Research and Work Immersion subjects on the Subjects page.
ALTER TABLE subjects
  ADD COLUMN weight_group VARCHAR(24) NOT NULL DEFAULT 'core'
  CHECK (weight_group IN (
    'core', 'academic_elective', 'arts_sports_wellness', 'field_exposure',
    'research_design', 'techpro_elective', 'work_immersion'
  ));

UPDATE subjects SET weight_group = 'academic_elective' WHERE category <> 'core';

COMMENT ON COLUMN subjects.weight_group IS
  'DepEd DO 015 s. 2026 Annex D Table 2 weight group; decides the WW/PT/EX split the term grade is computed with.';

-- 2. One column of the class record: a quiz, a task, a summative test or
--    the term exam, with its highest possible score.
--
-- `exam_part` only for the Examinations component, because DO 015 weights
-- ST1, ST2 and the Term Examination separately (30/30/40) inside it. The
-- CHECK keeps the two columns consistent: an exam item must say which part
-- it is, and nothing else may claim one.
CREATE TABLE assessment_items (
  id SERIAL PRIMARY KEY,
  class_offering_id INTEGER NOT NULL REFERENCES class_offerings(id) ON DELETE RESTRICT,
  grading_period_id INTEGER NOT NULL REFERENCES grading_periods(id) ON DELETE RESTRICT,
  component VARCHAR(2) NOT NULL CHECK (component IN ('ww', 'pt', 'ex')),
  exam_part VARCHAR(3) CHECK (exam_part IN ('st1', 'st2', 'te')),
  title VARCHAR(120) NOT NULL,
  highest_possible_score NUMERIC(7,2) NOT NULL CHECK (highest_possible_score > 0),
  sequence INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  import_id INTEGER REFERENCES bulk_imports(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CHECK ((component = 'ex') = (exam_part IS NOT NULL))
);

CREATE INDEX idx_assessment_items_offering_period
  ON assessment_items(class_offering_id, grading_period_id);

-- 3. One learner's score on one item.
--
-- "Not above the highest possible score" cannot be a CHECK (it lives on the
-- other table), so the controller enforces it. A row that does not exist
-- means "not yet scored" — deliberately different from a 0, which is a real
-- score; the calculator refuses to produce a grade while any is missing.
CREATE TABLE assessment_scores (
  id SERIAL PRIMARY KEY,
  assessment_item_id INTEGER NOT NULL REFERENCES assessment_items(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  raw_score NUMERIC(7,2) NOT NULL CHECK (raw_score >= 0),
  recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (assessment_item_id, student_id)
);

CREATE INDEX idx_assessment_scores_student ON assessment_scores(student_id);

-- 4. The breakdown a submitted grade was computed from.
--
-- A snapshot, taken at submission, so the grade on record always shows the
-- exact figures behind it — even if a score is corrected afterwards and not
-- yet resubmitted. `grade_value` stays the official number every other part
-- of the System reads; NULL here means a grade from before the Class Record.
ALTER TABLE grades ADD COLUMN computation JSONB;

COMMENT ON COLUMN grades.computation IS
  'Snapshot of the DO 015 computation (components, PS, WS, initial grade, mode) the grade_value came from, taken at submission.';

-- Down Migration

ALTER TABLE grades DROP COLUMN computation;
DROP TABLE assessment_scores;
DROP TABLE assessment_items;
ALTER TABLE subjects DROP COLUMN weight_group;
