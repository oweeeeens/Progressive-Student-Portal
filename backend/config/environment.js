// Is this a real deployment, or somebody's laptop?
//
// Until now the app had no notion of this at all — every development-only
// escape hatch was guarded by a sentence in DEPLOYMENT.md and nothing else.
// Two of them would do serious damage if they were ever set on the live
// system, and both would do it silently:
//
//   DEV_PLACEHOLDER_PASSWORD  every account created and every password
//                             reset gets the same known string
//   EMAIL_DEV_FALLBACK        users are told a reset link was sent while it
//                             is written to a server log instead
//
// config/rateLimits.js already has the right shape for this — validate, fall
// back to the safe value, and say so out loud at boot. This file is what
// lets the other two follow it.
//
// NODE_ENV is the convention every Node host sets; Railway sets it to
// 'production' automatically. Anything else (including unset, which is the
// case on a dev machine) is treated as not-production, because the failure
// we are guarding against is a hatch being left ON in production, not one
// being off in development.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Shared by the hatches below: refuse the override in production, and say
// so once at boot rather than failing quietly at the moment it matters.
function devOnlyFlag(name, isSet) {
  if (!isSet) return false;
  if (IS_PRODUCTION) {
    console.warn(
      `${name} is set, but this is a production deployment — the override is being IGNORED. ` +
        'Remove it from the environment; it is a development-only convenience.'
    );
    return false;
  }
  console.warn(`${name} is set. This should only ever be true on a development machine.`);
  return true;
}

module.exports = { IS_PRODUCTION, devOnlyFlag };
