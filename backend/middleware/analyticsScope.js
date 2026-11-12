// Who may open Analytics, and how much of the school they see.
//
//   admin, principal, guidance_counselor  → the whole school (no scope set)
//   anyone who ADVISES a section          → only the sections they advise
//   everyone else                         → 403
//
// Advisers were given Analytics (2026-11-12) because the person who acts on
// "who is at risk of failing" is the learner's adviser. Their view is the
// same page and the same numbers, narrowed to their own learners: the scope
// set here becomes `sectionIds` in analyticsController.parseFilters and is
// applied by analyticsCalculator.filterRows to every view and export. By
// assignment (sections.adviser_id), not by role label — the CLAUDE.md rule.
const { pool } = require('../config/db');

const SCHOOL_WIDE_ROLES = ['admin', 'principal', 'guidance_counselor'];

async function scopeAnalytics(req, res, next) {
  if (SCHOOL_WIDE_ROLES.includes(req.user.role)) return next();
  if (req.user.role === 'student') return res.status(403).json({ error: 'Analytics is not available to students.' });
  // Every section they advise, in any school year: Analytics already picks
  // the year from the grading period being viewed, so the scope only has to
  // say whose learners these are.
  const sections = (
    await pool.query('SELECT id FROM sections WHERE adviser_id = $1 AND is_active = TRUE', [req.user.id])
  ).rows;
  if (sections.length === 0) {
    return res.status(403).json({ error: 'Analytics is available to section advisers and school-wide staff.' });
  }
  req.analyticsScope = { sectionIds: sections.map((s) => s.id) };
  next();
}

module.exports = { scopeAnalytics, SCHOOL_WIDE_ROLES };
