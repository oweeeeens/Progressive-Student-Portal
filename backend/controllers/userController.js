// Admin/registrar staff account management — listing and the manual
// password-reset fallback. Student accounts are managed via Student
// Records instead (studentController.resetPassword), keyed off the
// student profile rather than a bare user id.
const userModel = require('../models/userModel');
const passwordReset = require('../services/passwordReset');

async function listStaff(req, res) {
  const users = await userModel.listStaff();
  res.json({ users });
}

// The fallback for when a staff member can't use the self-service
// forgot-password flow (e.g. no access to that inbox anymore) — generates
// a new temp password immediately and forces a change on next login. Same
// one-time-reveal pattern as account creation: the password is returned
// exactly once, in this response.
async function resetPassword(req, res) {
  const user = await userModel.findById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const tempPassword = await passwordReset.resetUserPasswordToTemp(user.id);
  res.json({ tempPassword });
}

module.exports = { listStaff, resetPassword };
