// Shared announcement presentation helpers. Announcements now render in two
// very different places — the staff feed on the dashboard (full body, edit
// and delete controls) and the student home (a banner plus a compact
// paginated panel) — so the byline wording and date formatting live here
// rather than being written twice and drifting apart.

// Only the roles allowed to post can ever appear as posted_by_role (see
// ANNOUNCEMENT_AUTHOR_ROLES in the backend), so there are deliberately no
// entries for roles that can't post — this map can't silently fall behind.
export const ANNOUNCEMENT_ROLE_LABELS = {
  admin: 'Admin',
  guidance_counselor: 'Guidance Counselor',
  registrar: 'Registrar',
  ict_faculty: 'ICT Faculty',
}

// A post counts as "edited" only once the create/update gap is large enough
// to rule out normal request-processing latency between the insert and the
// first read back of the same row.
export const ANNOUNCEMENT_EDITED_THRESHOLD_MS = 5000

// Full timestamp — used where a reader may need to tell two posts from the
// same day apart (the staff feed).
export function formatAnnouncementDateTime(isoString) {
  return new Date(isoString).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Date only — used in the compact student panel, where a time of day adds
// width without telling a student anything they act on.
export function formatAnnouncementDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// "Posted by Jane Cruz (Registrar) on 14 Oct 2026, 9:02 AM (edited)"
export function announcementByline(announcement) {
  const role = ANNOUNCEMENT_ROLE_LABELS[announcement.posted_by_role] || announcement.posted_by_role
  const edited =
    new Date(announcement.updated_at) - new Date(announcement.created_at) > ANNOUNCEMENT_EDITED_THRESHOLD_MS
  return `Posted by ${announcement.posted_by_name} (${role}) on ${formatAnnouncementDateTime(
    announcement.created_at
  )}${edited ? ' (edited)' : ''}`
}
