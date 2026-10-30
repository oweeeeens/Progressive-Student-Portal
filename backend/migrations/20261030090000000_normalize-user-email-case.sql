-- Up Migration

-- Makes an account's email mean the same thing however it is typed.
--
-- `users.email` is VARCHAR UNIQUE, and Postgres compares varchar with `=`
-- case-sensitively, so until now `Admin@x.com` and `admin@x.com` were two
-- different accounts that the UNIQUE constraint would happily let coexist.
-- Three live consequences, all of which contributed to an admin locking
-- themselves out of the deployment:
--
--   * seed:admin's "does this admin already exist?" guard is a lookup by
--     email. Re-type ADMIN_EMAIL in the Railway dashboard with a different
--     case and the next deploy creates a SECOND admin row, holding the
--     original ADMIN_PASSWORD. One case then works with the old password
--     and the other with the new one.
--   * Login is the same lookup, so an autofilled or hand-typed variation
--     simply fails, reporting "invalid email or password".
--   * Worst: forgot-password looks the account up the same way and then
--     deliberately answers "if an account exists, a link has been sent"
--     whether or not it found one — so a wrong-case request silently sends
--     nothing, on the one feature a locked-out user has left.
--
-- Step 1: refuse to run if the damage already exists. A migration that
-- half-applies against the production database is how an account
-- disappears, so this raises rather than guessing which row to keep —
-- merging two real accounts is a decision for a person, not a script.
DO $$
DECLARE
  duplicate_emails TEXT;
BEGIN
  SELECT string_agg(DISTINCT lower(email), ', ')
    INTO duplicate_emails
    FROM users
   GROUP BY lower(email)
  HAVING count(*) > 1;

  IF duplicate_emails IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalise user emails: these differ only by capitalisation and would collide: %. '
      'Decide which account is real, move any records off the other, delete it, then re-run.',
      duplicate_emails;
  END IF;
END $$;

-- Step 2: canonicalise what is already stored. Trimmed as well as
-- lowercased — a trailing space is the same class of invisible mismatch.
UPDATE users
   SET email = lower(btrim(email)),
       updated_at = now()
 WHERE email <> lower(btrim(email));

-- Step 3: stop it coming back. The application normalises on every write
-- (models/userModel.js), but the database is what guarantees it — the index
-- is the reason two capitalisations can never again become two accounts.
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));

-- Down Migration

DROP INDEX idx_users_email_lower;
-- The lower-casing is deliberately NOT reversed: the original
-- capitalisation was not recorded anywhere, so there is nothing to restore
-- it from, and re-introducing mixed case would only recreate the bug.
