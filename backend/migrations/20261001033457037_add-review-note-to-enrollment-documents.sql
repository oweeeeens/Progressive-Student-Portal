-- Up Migration

-- Lets a registrar/admin explain WHY a document was rejected (or just leave
-- a note on approval) — the review decision needs more than a status flag.
ALTER TABLE enrollment_documents ADD COLUMN review_note TEXT;

-- Down Migration

ALTER TABLE enrollment_documents DROP COLUMN review_note;
