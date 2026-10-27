const { positiveIntFromEnv } = require('../utils/envNumber');
// How hard the auth endpoints push back, in one place.
//
// The login limiter exists to slow password guessing, and on a deployment it
// must stay strict. But the same ten-attempts-per-fifteen-minutes ceiling
// also stops anyone driving the app from a script — the seed that signs in
// as nine staff accounts in a row, or a browser pass over every screen as
// each role — and the only way round it was to restart the server to clear
// the in-memory counter.
//
// So the ceiling is a setting with a safe default rather than a constant.
// The default IS the production value: an unset or malformed variable gives
// the strict limit, never an open door. Raising it is a deliberate, local
// act, and DEPLOYMENT.md says not to set it on a server.

const DEFAULTS = {
  loginMax: 10,
  loginWindowMinutes: 15,
  forgotPasswordMax: 5,
  forgotPasswordWindowMinutes: 15,
};

// positiveIntFromEnv moved to utils/envNumber.js when the risk thresholds
// needed the same rule — a malformed value must fall back to the safe
// default and say so, never become NaN.
const loginMax = positiveIntFromEnv('LOGIN_RATE_LIMIT_MAX', DEFAULTS.loginMax);
const loginWindowMinutes = positiveIntFromEnv('LOGIN_RATE_LIMIT_WINDOW_MINUTES', DEFAULTS.loginWindowMinutes);

// One line at boot whenever the limit is not the shipped default, so a
// raised ceiling can never be a surprise — including on a server where
// somebody set it by mistake.
if (loginMax !== DEFAULTS.loginMax || loginWindowMinutes !== DEFAULTS.loginWindowMinutes) {
  console.warn(
    `Login rate limit raised to ${loginMax} attempts per ${loginWindowMinutes} minutes ` +
      `(default: ${DEFAULTS.loginMax} per ${DEFAULTS.loginWindowMinutes}). ` +
      'This should only be set on a development machine.'
  );
}

module.exports = {
  DEFAULTS,
  login: {
    max: loginMax,
    windowMs: loginWindowMinutes * 60 * 1000,
  },
  // Deliberately NOT configurable. This one protects somebody else's inbox
  // from being used to send mail they did not ask for, so it is not mine to
  // relax for convenience.
  forgotPassword: {
    max: DEFAULTS.forgotPasswordMax,
    windowMs: DEFAULTS.forgotPasswordWindowMinutes * 60 * 1000,
  },
};
