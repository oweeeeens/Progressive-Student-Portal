-- Up Migration

-- One-time correction of learner accounts whose NAME drifted from the student
-- record (2026-11-22). Since 2026-11-18 every record edit carries the name and
-- email to the linked account (studentModel.syncLinkedAccount), so drift can
-- no longer begin; this corrects what had drifted before that.
--
-- NAMES are corrected: the account's name is only what the header shows, so
-- copying the record's name over it cannot affect anyone's sign-in.
--
-- LOGIN EMAILS are deliberately NOT changed here. Before the sync, an email
-- could differ for two opposite reasons — the registrar corrected the record
-- (the account is stale) or the learner changed their own login email in
-- Profile (the record is stale) — and the data cannot tell which. Copying the
-- record's email over the account's could leave a learner unable to sign in.
-- They are counted in the notice below for the registrar to settle with the
-- learner; saving that record then syncs the two.
DO $$
DECLARE
  names_fixed INTEGER;
  emails_differ INTEGER;
BEGIN
  UPDATE users u
     SET full_name = s.first_name || ' ' || s.last_name,
         updated_at = now()
    FROM students s
   WHERE s.user_id = u.id
     AND u.full_name IS DISTINCT FROM s.first_name || ' ' || s.last_name;
  GET DIAGNOSTICS names_fixed = ROW_COUNT;

  SELECT COUNT(*) INTO emails_differ
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE s.email IS NOT NULL AND lower(u.email) <> lower(trim(s.email));

  RAISE NOTICE 'student accounts: % name(s) corrected; % login email(s) differ from the record and were left for the registrar', names_fixed, emails_differ;
END $$;

-- Down Migration

-- Nothing to undo: the names written above are the student records' own
-- names, and the previous (drifted) values were not kept.
SELECT 1;
