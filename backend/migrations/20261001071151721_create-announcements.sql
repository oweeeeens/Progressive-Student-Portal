-- Up Migration

-- School-wide announcements, visible to every authenticated role — see
-- announcementController.js. posted_by uses ON DELETE RESTRICT (not the
-- CASCADE used for ephemeral password_reset_tokens) since an announcement
-- is an institutional record worth keeping even if the poster's account is
-- later deactivated.
CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  file_path VARCHAR(500),
  original_filename VARCHAR(255),
  posted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_created_at ON announcements(created_at DESC);

-- Down Migration

DROP TABLE announcements;
