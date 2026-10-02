-- Up Migration

-- New role: ICT faculty can post announcements (see create_announcements
-- migration) and are creatable via the staff account creation flow, same as
-- principal before them.
ALTER TYPE user_role ADD VALUE 'ict_faculty';

-- Down Migration

-- Postgres cannot remove a single enum value without recreating the type —
-- documented no-op, same as the principal-role migration before this one.
