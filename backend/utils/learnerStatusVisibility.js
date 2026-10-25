// Strips learner-status fields a role isn't allowed to see from an outgoing
// student payload. Server-side enforcement, deliberately: hiding a field in
// the UI leaves it sitting in the JSON for anyone who opens devtools or
// calls the endpoint directly, which for a minor's disability or household
// -assistance status is not an acceptable boundary.
//
// Applied at the controller edge (every read path that returns a student),
// not in the model — the model's job is "what's in the table", and the same
// row is legitimately allowed to carry different fields depending on who
// asked for it.
const { LEARNER_STATUS_KEYS, fieldsVisibleTo } = require('../config/learnerStatus');

// Returns a copy of `student` carrying only the learner-status fields this
// role may see. Every other field passes through untouched.
function stripLearnerStatus(user, student) {
  if (!student) return student;
  const allowed = new Set(fieldsVisibleTo(user?.role));
  const result = { ...student };
  for (const key of LEARNER_STATUS_KEYS) {
    if (!allowed.has(key)) delete result[key];
  }
  return result;
}

function stripLearnerStatusFromList(user, students) {
  return students.map((student) => stripLearnerStatus(user, student));
}

// Which of the three a role may FILTER by. Same map as visibility on
// purpose: letting someone filter a roster by a field they can't read would
// leak the value by inference — "show me only 4Ps learners" answers the
// question just as well as showing the column would.
function allowedFilterKeys(user) {
  return new Set(fieldsVisibleTo(user?.role));
}

module.exports = { stripLearnerStatus, stripLearnerStatusFromList, allowedFilterKeys };
