// Signs a real JWT identical in shape to authController.signToken — lets
// fixtures hand out a working Authorization header for a test user without
// a real login round-trip, while still exercising the exact same
// requireAuth verification path every real request goes through.
require('dotenv').config();

const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../../../config/auth');

function signTestToken(user) {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

module.exports = { signTestToken };
