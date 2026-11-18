-- Up Migration

-- SUBJECT ENROLLMENT — which learners are enrolled in which class.
--
-- Until now a class's roster was never stored: it was worked out on the fly
-- as "every student whose current section is the class's section", in about
-- fifteen places. The panel asked for enrollment to be a real record, so
-- that grade entry can accept only learners enrolled in the class, and so a
-- learner who changes section keeps a history of the classes they were in.
--
-- One row = one learner in one class offering (which already carries the
-- subject, section, school year and term).
--   status 'enrolled'  in the class now; on its roster.
--   status 'moved'     was in the class and left it (changed section, or the
--                      class moved section). Kept as history: the learner's
--                      grades and scores stay attached to that class.
-- A learner is in a class at most once (UNIQUE); moving back re-enrolls the
-- same row rather than adding a second.
CREATE TABLE class_enrollments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  class_offering_id INTEGER NOT NULL REFERENCES class_offerings(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'moved')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CONSTRAINT class_enrollments_student_offering_key UNIQUE (student_id, class_offering_id)
);

-- The roster query: "who is enrolled in class X right now".
CREATE INDEX class_enrollments_offering_enrolled_idx ON class_enrollments (class_offering_id) WHERE status = 'enrolled';
-- A learner's own classes.
CREATE INDEX class_enrollments_student_idx ON class_enrollments (student_id);

-- AUTOMATIC ENROLLMENT, enforced by the database itself.
--
-- Triggers rather than application code on purpose: a learner gets a
-- section from the student form, the bulk import, seed scripts and the
-- occasional manual fix, and a rule written into each of those is a rule
-- one of them eventually forgets. Here every path that changes a section
-- (or adds a class) enrolls, with nothing to remember.

-- 1. A learner is given a section, or changes section.
--    - Their enrollments in classes of any OTHER section end ('moved').
--      Their grades, scores and attendance are not touched, so history
--      stays on the old classes.
--    - They are enrolled in every active class of the new section.
CREATE FUNCTION enroll_student_in_section_classes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.current_section_id IS NOT DISTINCT FROM OLD.current_section_id THEN
    RETURN NEW;
  END IF;

  UPDATE class_enrollments ce
     SET status = 'moved', ended_at = now()
    FROM class_offerings co
   WHERE ce.class_offering_id = co.id
     AND ce.student_id = NEW.id
     AND ce.status = 'enrolled'
     AND co.section_id IS DISTINCT FROM NEW.current_section_id;

  IF NEW.current_section_id IS NOT NULL THEN
    INSERT INTO class_enrollments (student_id, class_offering_id)
    SELECT NEW.id, co.id
      FROM class_offerings co
     WHERE co.section_id = NEW.current_section_id
       AND co.is_active = TRUE
    ON CONFLICT (student_id, class_offering_id) DO UPDATE
       SET status = 'enrolled', ended_at = NULL, enrolled_at = now()
     WHERE class_enrollments.status <> 'enrolled';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER students_enroll_in_section_classes
  AFTER INSERT OR UPDATE OF current_section_id ON students
  FOR EACH ROW EXECUTE FUNCTION enroll_student_in_section_classes();

-- 2. A class is added to a section (including mid-year), reactivated, or
--    moved to another section.
--    - Moved: the old section's learners leave it ('moved'). The app refuses
--      to move a class that already has grades or scores
--      (classOfferingController.updateClassOffering), so nothing recorded
--      is orphaned by this.
--    - Active: every learner currently in the section is enrolled.
--    A DEACTIVATED class keeps its enrollments as history.
CREATE FUNCTION enroll_section_in_class() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.section_id IS DISTINCT FROM OLD.section_id THEN
    UPDATE class_enrollments
       SET status = 'moved', ended_at = now()
     WHERE class_offering_id = NEW.id AND status = 'enrolled';
  END IF;

  IF NEW.is_active = TRUE AND (
       TG_OP = 'INSERT'
       OR NEW.section_id IS DISTINCT FROM OLD.section_id
       OR OLD.is_active = FALSE
     ) THEN
    INSERT INTO class_enrollments (student_id, class_offering_id)
    SELECT s.id, NEW.id
      FROM students s
     WHERE s.current_section_id = NEW.section_id
    ON CONFLICT (student_id, class_offering_id) DO UPDATE
       SET status = 'enrolled', ended_at = NULL, enrolled_at = now()
     WHERE class_enrollments.status <> 'enrolled';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER class_offerings_enroll_section
  AFTER INSERT OR UPDATE OF section_id, is_active ON class_offerings
  FOR EACH ROW EXECUTE FUNCTION enroll_section_in_class();

-- BACKFILL for the data already in the system.
-- (a) Today's rosters: every learner with a section is enrolled in that
--     section's active classes — exactly the roster the app derived before.
INSERT INTO class_enrollments (student_id, class_offering_id)
SELECT s.id, co.id
  FROM students s
  JOIN class_offerings co ON co.section_id = s.current_section_id AND co.is_active = TRUE
ON CONFLICT (student_id, class_offering_id) DO NOTHING;

-- (b) History: any learner who already has a grade or a score in a class
--     they are not enrolled in now (they changed section, or the class was
--     deactivated) is recorded as having been in it, so those grades still
--     list the class they came from.
INSERT INTO class_enrollments (student_id, class_offering_id, status, ended_at)
SELECT pairs.student_id, pairs.class_offering_id, 'moved', now()
  FROM (
    SELECT student_id, class_offering_id FROM grades
    UNION
    SELECT sc.student_id, ai.class_offering_id
      FROM assessment_scores sc
      JOIN assessment_items ai ON ai.id = sc.assessment_item_id
  ) pairs
ON CONFLICT (student_id, class_offering_id) DO NOTHING;

-- Down Migration

DROP TRIGGER IF EXISTS class_offerings_enroll_section ON class_offerings;
DROP TRIGGER IF EXISTS students_enroll_in_section_classes ON students;
DROP FUNCTION IF EXISTS enroll_section_in_class();
DROP FUNCTION IF EXISTS enroll_student_in_section_classes();
DROP TABLE IF EXISTS class_enrollments;
