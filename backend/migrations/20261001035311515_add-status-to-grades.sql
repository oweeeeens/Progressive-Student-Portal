-- Up Migration

-- A grade a subject teacher enters starts as 'draft'. The risk engine must
-- only ever read 'finalized' grades (per CLAUDE.md: only post-adviser-
-- approval data feeds the risk formula) — a draft is unreviewed and could
-- still be wrong. The adviser for that student's section finalizes it.
CREATE TYPE grade_status AS ENUM ('draft', 'finalized');

ALTER TABLE grades ADD COLUMN status grade_status NOT NULL DEFAULT 'draft';
ALTER TABLE grades ADD COLUMN finalized_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE grades ADD COLUMN finalized_at TIMESTAMP;

-- Down Migration

ALTER TABLE grades DROP COLUMN finalized_at;
ALTER TABLE grades DROP COLUMN finalized_by;
ALTER TABLE grades DROP COLUMN status;
DROP TYPE grade_status;
