// Central place for auth-related settings, read once at startup. Fails fast
// if JWT_SECRET is missing so a misconfigured deployment can't silently sign
// tokens with an empty/undefined secret.
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to backend/.env (see .env.example).');
}

const { positiveIntFromEnv } = require('../utils/envNumber');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h'; // roughly one school day
// "Remember me on this device" ticked: the sign-in lasts this long instead of
// one school day. Safe to make long because a deactivated account loses
// access on its next request, and a password change or reset ends every
// session issued before it (users.password_changed_at, checked in
// authMiddleware).
const REMEMBER_ME_EXPIRES_IN = process.env.REMEMBER_ME_EXPIRES_IN || '30d';

// Password reset by emailed 6-digit code. A code has only a million values,
// so it is safe only because guessing is cut off three ways: it expires
// quickly, it is burned after a few wrong tries, and the reset endpoints are
// rate-limited per IP (config/rateLimits.js). 5 tries out of 1,000,000 is a
// 0.0005% chance per code.
const RESET_CODE_TTL_MINUTES = positiveIntFromEnv('RESET_CODE_TTL_MINUTES', 15);
const RESET_CODE_MAX_ATTEMPTS = positiveIntFromEnv('RESET_CODE_MAX_ATTEMPTS', 5);
const BCRYPT_SALT_ROUNDS = 10;
// The floor for any password a person chooses — the forced first-login
// change, the self-service reset, and the server-side rescue script all
// check against this one value. It was a local constant in authController
// until the rescue script needed it too, which is exactly the point at
// which a threshold belongs in config rather than beside the logic.
const MIN_PASSWORD_LENGTH = 8;

// Every role this system recognizes. "student" also covers parent-level
// (view-own-records) access for now — a separate parent role/account type
// was intentionally deferred (see CLAUDE.md scope notes).
//
// 'ict_faculty' is gone from this list (2026-11-11). It existed only to post
// announcements, and Announcements was removed to keep the System to its
// title. The value still exists in the database's user_role enum — Postgres
// cannot drop an enum value without rebuilding the type — but the migration
// that removed the feature deactivated every such account, and nothing can
// create a new one.
const USER_ROLES = [
  'admin',
  'adviser',
  'subject_teacher',
  'guidance_counselor',
  'registrar',
  'student',
  'principal',
];

// Roles creatable through the account-creation form (POST /api/auth/register,
// admin/registrar only). Deliberately excludes 'admin' (not a role you hand
// out through a web form). 'student' IS included — enrollment used to
// auto-provision a student's account when their enrollment_status flipped
// to 'enrolled' (see the now-removed Enrollment module), but now that
// enrollment happens on paper before a student's record is even added,
// there's no event left to trigger that automatically. A student account is
// created through this same form instead, linked to an existing Student
// Record (see authController.register's studentId handling) rather than
// collecting a fresh name/email the way a staff account does.
const CREATABLE_ROLES = [
  'adviser',
  'subject_teacher',
  'guidance_counselor',
  'registrar',
  'principal',
  'student',
];

// Academic Setup — school years, grading periods, sections, subjects, class
// offerings. The admin and the REGISTRAR change it (the registrar since
// 2026-11-26, at the group's request: they keep the school's records, and
// sections and classes are where those records are placed). The principal
// reads it. Every setup route, and the account-linking rule (linking an
// adviser or teacher writes the same two columns setup does), reads these
// two lists, so they cannot drift apart.
const ACADEMIC_SETUP_EDITORS = ['admin', 'registrar'];
const ACADEMIC_SETUP_READERS = ['admin', 'registrar', 'principal'];

// Roles that read the grade reports (gradesheet, class grade report) for
// EVERY section and class, not only what they advise or teach: the admin,
// and the registrar (2026-11-26), who keeps the school's records. Reports
// are read-only.
const ALL_GRADE_REPORT_READERS = ['admin', 'registrar'];

// The ADVISER GRADESHEET is wider than the class report (2026-11-26, at the
// group's request). These roles open every section's gradesheet: the admin
// and registrar, plus the principal and the guidance counselor, who already
// read grades school-wide on Analytics. Everyone else opens only the
// sections they advise or teach into (reportController.gradesheet) — the
// Data Privacy Act's proportionality rule the system follows elsewhere.
const SCHOOLWIDE_GRADESHEET_READERS = ['admin', 'registrar', 'principal', 'guidance_counselor'];

module.exports = {
  ACADEMIC_SETUP_EDITORS,
  ACADEMIC_SETUP_READERS,
  ALL_GRADE_REPORT_READERS,
  SCHOOLWIDE_GRADESHEET_READERS,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  REMEMBER_ME_EXPIRES_IN,
  RESET_CODE_TTL_MINUTES,
  RESET_CODE_MAX_ATTEMPTS,
  BCRYPT_SALT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  USER_ROLES,
  CREATABLE_ROLES,
};
