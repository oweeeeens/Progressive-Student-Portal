// Restricts a route to specific roles. Must run after requireAuth, which
// attaches req.user. This only checks "is this role allowed on this route at
// all" — per-record scoping (e.g. an adviser seeing only their own section)
// is a concern for each module's own controller/model, not this middleware.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }

    next();
  };
}

module.exports = { requireRole };
