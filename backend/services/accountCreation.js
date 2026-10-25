// Shared "create a student's portal account from their existing Student
// Record" logic — the exact same checks (already has an account? personal
// email on file? that email already taken?) used by both the single-account
// form (authController.register's student branch) and bulk account creation
// (userController.bulkCreateStudentAccounts), so there is exactly one place
// that decides whether a student is eligible for a portal login.
const userModel = require('../models/userModel');
const studentModel = require('../models/studentModel');
const { generateTempPassword } = require('../utils/password');

// Returns { ok: true, user, tempPassword } on success, or
// { ok: false, status, error } on failure — status is an HTTP status code so
// callers that talk directly to a client (authController.register) can just
// forward it, while callers aggregating many results (bulk creation) can
// ignore status and keep only the message.
async function createStudentAccount(studentId) {
  const student = await studentModel.findByIdUnscoped(studentId);
  if (!student) {
    return { ok: false, status: 400, error: 'studentId does not refer to an existing student record.' };
  }
  if (student.user_id) {
    return { ok: false, status: 409, error: 'This student already has a portal account.' };
  }
  if (!student.email) {
    return {
      ok: false,
      status: 400,
      error: 'This student has no personal email on file — add one to their Student Record first.',
    };
  }

  const existingByEmail = await userModel.findByEmail(student.email);
  if (existingByEmail) {
    return { ok: false, status: 409, error: 'An account with that email already exists.' };
  }

  const tempPassword = generateTempPassword();
  const user = await userModel.createUser({
    email: student.email,
    password: tempPassword,
    fullName: `${student.first_name} ${student.last_name}`,
    role: 'student',
    mustChangePassword: true,
  });
  await studentModel.linkUserAccount(student.id, user.id);

  return { ok: true, user, tempPassword };
}

module.exports = { createStudentAccount };
