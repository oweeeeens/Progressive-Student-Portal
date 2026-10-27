// Admin/registrar User Management — the full account roster (staff AND
// students), editing identity fields, activating/deactivating, bulk student
// account creation, and the manual password-reset fallback. listStaff stays
// separate (see userModel.js) since it's a stable, unfiltered shape other
// admin pickers (Sections, Class Offerings) already depend on.
const userModel = require('../models/userModel');
const studentModel = require('../models/studentModel');
const passwordReset = require('../services/passwordReset');
const { createStudentAccount } = require('../services/accountCreation');
const { CREATABLE_ROLES } = require('../config/auth');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function listStaff(req, res) {
  const users = await userModel.listStaff();
  res.json({ users });
}

async function listAccounts(req, res) {
  const { search, role, status, sectionId, page, pageSize } = req.query;
  const result = await userModel.listAccounts({
    search,
    role: role || undefined,
    status: status || undefined,
    sectionId: sectionId ? Number(sectionId) : undefined,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });
  res.json(result);
}

async function getStats(req, res) {
  const counts = await userModel.countAccounts();
  res.json({ counts });
}

// An admin account may only ever be acted on by that same admin.
//
// CREATABLE_ROLES already keeps 'admin' off both account-creation forms
// because admin was never a role handed out through a web form. The same
// has to hold for acting on one that already exists: without this, a
// registrar could reset the admin's password and read it straight out of
// the response, repoint the admin's email and then use forgot-password, or
// simply deactivate every admin and lock the school out of its own system.
// Each of the three handlers below reaches a different one of those, so the
// check lives here once rather than three times.
//
// Deliberately not "is the caller an admin": one admin resetting another
// admin's password is the same escalation in a school that later has two.
// The only person who may act on an admin account is that account's owner.
function assertCanActOnTarget(req, res, target) {
  if (target.role === 'admin' && target.id !== req.user.id) {
    res.status(403).json({ error: 'Admin accounts can only be managed by that admin.' });
    return false;
  }
  return true;
}

// Edits name/email/role. Role changes are restricted to CREATABLE_ROLES
// (same list the creation form offers — 'admin' is never handed out through
// a web form, on either path) and blocked outright for an account that
// currently advises a section or teaches a class offering, since those rows
// reference this user by id and assume their role still matches.
async function updateAccount(req, res) {
  const id = Number(req.params.id);
  const existing = await userModel.findById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Account not found.' });
  }
  // Before any field is read: the admin-reassignment block further down only
  // runs when the role is actually changing, so a name- or email-only edit
  // used to slip past it entirely.
  if (!assertCanActOnTarget(req, res, existing)) return;

  const { fullName, email, role } = req.body;
  const data = {};

  if (fullName !== undefined) {
    if (!fullName.trim()) {
      return res.status(400).json({ error: 'fullName cannot be empty.' });
    }
    data.fullName = fullName.trim();
  }

  if (email !== undefined) {
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'That email address does not look valid.' });
    }
    const existingByEmail = await userModel.findByEmail(email);
    if (existingByEmail && existingByEmail.id !== id) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    data.email = email;
  }

  if (role !== undefined && role !== existing.role) {
    if (existing.role === 'admin' || role === 'admin') {
      return res.status(400).json({ error: 'Admin accounts cannot be reassigned through this form.' });
    }
    if (!CREATABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${CREATABLE_ROLES.join(', ')}` });
    }
    if (await userModel.hasActiveAssignments(id)) {
      return res.status(409).json({
        error: 'This user still advises a section or teaches a class — reassign those in Academic Setup first.',
      });
    }
    data.role = role;
  }

  const updated = await userModel.updateUser(id, data);
  res.json({ user: updated });
}

// Activate/deactivate — never a hard delete, so historical records (grades
// submitted, interventions logged, attendance marked) stay intact. Blocks
// deactivating your own account so an admin can't lock themselves out.
async function setAccountActive(req, res) {
  const id = Number(req.params.id);
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive must be true or false.' });
  }
  if (id === req.user.id && !isActive) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }

  const existing = await userModel.findById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Account not found.' });
  }
  if (!assertCanActOnTarget(req, res, existing)) return;

  const updated = await userModel.setActive(id, isActive);
  if (!updated) {
    return res.status(404).json({ error: 'Account not found.' });
  }
  res.json({ user: updated });
}

// The fallback for when a staff member can't use the self-service
// forgot-password flow (e.g. no access to that inbox anymore) — generates
// a new temp password immediately and forces a change on next login. Same
// one-time-reveal pattern as account creation: the password is returned
// exactly once, in this response. Works for any user id, staff or student —
// resetUserPasswordToTemp only needs the id, not the role.
async function resetPassword(req, res) {
  const user = await userModel.findById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  // The sharpest of the three: this hands the new password back in the
  // response, so without the guard it is a one-request account takeover.
  if (!assertCanActOnTarget(req, res, user)) return;

  const tempPassword = await passwordReset.resetUserPasswordToTemp(user.id);
  res.json({ tempPassword });
}

// Bulk-creates portal accounts for a batch of existing, not-yet-provisioned
// Student Records — reuses the exact same per-student logic as the single
// "New Student Account" form (services/accountCreation.js) in a loop, rather
// than a second copy of the eligibility checks. Partial success is expected
// and fine (e.g. one row's email collided with another account created
// moments ago) — every row is attempted independently and reported back.
async function bulkCreateStudentAccounts(req, res) {
  const { studentIds } = req.body;
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'studentIds must be a non-empty array.' });
  }

  const created = [];
  const failures = [];

  for (const studentId of studentIds) {
    const result = await createStudentAccount(Number(studentId));
    if (result.ok) {
      const student = await studentModel.findByIdUnscoped(Number(studentId));
      created.push({
        studentId: Number(studentId),
        studentName: student ? `${student.first_name} ${student.last_name}` : null,
        email: result.user.email,
        tempPassword: result.tempPassword,
      });
    } else {
      failures.push({ studentId: Number(studentId), error: result.error });
    }
  }

  res.status(201).json({ created, failures });
}

module.exports = {
  listStaff,
  listAccounts,
  getStats,
  updateAccount,
  setAccountActive,
  resetPassword,
  bulkCreateStudentAccounts,
};
