// Auto-creates a student's portal account once they're enrolled, per
// CLAUDE.md's auth scope ("students use personal email — no school
// Gmail/Workspace accounts available"). Mirrors the staff account creation
// flow in authController.js: a system-generated temp password, forced
// change on first login.
//
// Deliberately self-checking and idempotent — every caller can call this
// unconditionally after any write that *might* have changed a student's
// enrollment_status or email, without first figuring out whether this is
// "the moment" it should fire. It only actually does anything the first
// time all three conditions line up:
//   - enrollment_status is 'enrolled'
//   - the student has a personal email on file
//   - no portal account exists yet (students.user_id is still null)
// Call sites: studentController (create/update) — a registrar setting
// enrollmentStatus to 'enrolled' with an email on file provisions the
// account right then. authController.register's studentId path (admin/
// registrar explicitly creating a student account from Student Records) is
// the other way one gets created; the two don't conflict since this one no-ops
// once an account already exists.
const studentModel = require('../models/studentModel');
const userModel = require('../models/userModel');
const { generateTempPassword } = require('../utils/password');

async function provisionStudentAccountIfReady(studentId) {
  const student = await studentModel.getAccountProvisioningInfo(studentId);
  if (!student) return null;
  if (student.enrollment_status !== 'enrolled') return null;
  if (student.user_id) return null; // already provisioned
  if (!student.email) return null; // nothing to create the login with yet

  const existingAccount = await userModel.findByEmail(student.email);
  if (existingAccount) {
    // The email is already in use by some other account (e.g. a staff
    // member who happens to share it, or a duplicate entered by mistake) —
    // don't silently hijack it. Leave the student unlinked; a registrar
    // will need to correct the email before this can proceed.
    return null;
  }

  const tempPassword = generateTempPassword();
  const user = await userModel.createUser({
    email: student.email,
    password: tempPassword,
    fullName: `${student.first_name} ${student.last_name}`,
    role: 'student',
    mustChangePassword: true,
  });
  await studentModel.linkUserAccount(studentId, user.id);

  return { userId: user.id, email: user.email, tempPassword };
}

module.exports = { provisionStudentAccountIfReady };
