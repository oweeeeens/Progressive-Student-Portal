// Resolves :studentId using the same visibility rules as Student Records
// (adviser -> own section, subject teacher -> own classes, student -> self,
// etc. — see studentModel.findById). "Can you see this student's profile"
// and "can you see this student's attendance history" are the same
// question, so this lets attendance routes reuse that one source of truth
// instead of re-deriving access rules.
const studentModel = require('../models/studentModel');

async function loadScopedStudent(req, res, next) {
  const student = await studentModel.findById(req.user, Number(req.params.studentId));
  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }
  req.scopedStudent = student;
  next();
}

module.exports = { loadScopedStudent };
