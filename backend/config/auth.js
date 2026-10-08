// Central place for auth-related settings, read once at startup. Fails fast
// if JWT_SECRET is missing so a misconfigured deployment can't silently sign
// tokens with an empty/undefined secret.
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to backend/.env (see .env.example).');
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h'; // roughly one school day
const BCRYPT_SALT_ROUNDS = 10;

// Every role this system recognizes. "student" also covers parent-level
// (view-own-records) access for now — a separate parent role/account type
// was intentionally deferred (see CLAUDE.md scope notes).
const USER_ROLES = [
  'admin',
  'adviser',
  'subject_teacher',
  'guidance_counselor',
  'registrar',
  'student',
  'principal',
  'ict_faculty',
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
  'ict_faculty',
  'student',
];

// Who can post an announcement — admin, registrar, guidance_counselor, or
// ICT faculty. Edit/delete is further restricted to the author or admin;
// see announcementController.js.
const ANNOUNCEMENT_AUTHOR_ROLES = ['admin', 'registrar', 'guidance_counselor', 'ict_faculty'];

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  BCRYPT_SALT_ROUNDS,
  USER_ROLES,
  CREATABLE_ROLES,
  ANNOUNCEMENT_AUTHOR_ROLES,
};
