// Verifies the JWT on incoming requests and attaches the current user to
// req.user. Re-fetches the user from the database on every request (rather
// than trusting the role/is_active baked into the token) so a deactivated
// account loses access immediately instead of waiting for its token to expire.
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/auth');
const userModel = require('../models/userModel');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  const user = await userModel.findById(payload.userId);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Account not found or deactivated.' });
  }

  // A password change or reset ends every session signed in before it. With
  // "Remember me" a sign-in lasts 30 days, so without this a session on a
  // lost or shared device would outlive the very reset meant to lock it out.
  // `iat` is whole seconds, so the change time is floored to match: a token
  // issued in the same second as the change (the fresh one change-password
  // hands back) still counts as after it.
  if (user.password_changed_at) {
    const changedAtSeconds = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
    if (typeof payload.iat === 'number' && payload.iat < changedAtSeconds) {
      return res.status(401).json({ error: 'Your password was changed. Please sign in again.' });
    }
  }

  // Enforced here, not just as a frontend redirect: a user created with a
  // temp password (staff or student account creation — see
  // services/accountCreation.js and authController.register) can't touch
  // anything except the auth endpoints (check who they are, change their
  // password) until they do. Checked against the full original URL, not
  // req.path, since requireAuth is reused across many routers mounted at
  // different prefixes.
  if (user.must_change_password && !req.originalUrl.startsWith('/api/auth/')) {
    return res.status(403).json({ error: 'You must change your password before continuing.', mustChangePassword: true });
  }

  req.user = user;
  // The verified token claims, for the one handler that re-issues a token
  // (change-password keeps the same "Remember me" lifetime via `rem`).
  req.auth = payload;
  next();
}

module.exports = { requireAuth };
