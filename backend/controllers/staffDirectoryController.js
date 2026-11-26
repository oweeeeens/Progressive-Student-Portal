// GET /api/staff-directory — the school's staff, for every signed-in user
// (2026-11-26, at the group's request: "so we can view it easily", students
// included, so a learner knows who their adviser and teachers are).
//
// Privacy (RA 10173, proportionality): a STUDENT sees each person's name,
// position and assignments, but never their email — removed here on the
// server, not merely hidden on the page. Staff see work emails too.
const staffDirectoryModel = require('../models/staffDirectoryModel');

async function getStaffDirectory(req, res) {
  const isStudent = req.user.role === 'student';
  const staff = await staffDirectoryModel.listStaff();
  const contacts = isStudent ? await staffDirectoryModel.getLearnerContacts(req.user.id) : null;

  const entries = staff.map((s) => {
    const entry = {
      id: s.id,
      fullName: s.full_name,
      role: s.role,
      advises: s.advises,
      teaches: s.teaches,
    };
    if (!isStudent) entry.email = s.email;
    if (contacts) {
      entry.isYourAdviser = contacts.adviserIds.includes(s.id);
      entry.isYourTeacher = contacts.teacherIds.includes(s.id);
    }
    return entry;
  });

  res.json({ staff: entries, showsEmail: !isStudent });
}

module.exports = { getStaffDirectory };
