// Reading numbers out of the environment, safely.
//
// Lifted out of config/rateLimits.js so the risk thresholds can use the same
// rule it already got right: a malformed value falls back to the shipped
// default and says so, rather than silently becoming NaN. Every comparison
// against NaN is false, so an unvalidated threshold does not merely use a
// wrong number — it stops the check from ever firing, with no error anywhere.

// A positive integer, or the default. Rejects missing, non-numeric, zero and
// negative values.
function positiveIntFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`${name}="${raw}" is not a positive integer — using the default of ${fallback}.`);
    return fallback;
  }
  return parsed;
}

// A number inside an inclusive range, or the default. Used for the risk
// thresholds, which are percentages and grades rather than counts, so they
// may legitimately be fractional — but a grade of 900 or -5 is a typo, not a
// policy, and would quietly turn a scored factor on or off for the whole
// school.
function numberInRangeFromEnv(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    console.warn(
      `${name}="${raw}" is not a number between ${min} and ${max} — using the default of ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

module.exports = { positiveIntFromEnv, numberInRangeFromEnv };
