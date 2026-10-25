// The three descriptive learner-status fields, and — critically — WHICH
// ROLES MAY SEE EACH ONE. This file is the single source of truth for that;
// the API strips fields from responses using this map (see
// utils/learnerStatusVisibility.js), so a role that can't see a field never
// receives it rather than merely not rendering it.
//
// These are reporting attributes only. They are deliberately absent from
// services/riskCalculator.js: the risk formula reads grades and attendance,
// and nothing here describes academic performance. A learner being a PWD or
// a 4Ps recipient must never be a reason the system flags them.

// 4Ps is narrower than the other two on purpose: it's household financial
// -assistance status. Guidance and the office roles need it for DepEd
// reporting and support referrals; a subject teacher marking attendance has
// no reason to see a family's economic circumstances, and an adviser's
// pastoral role doesn't require it either.
const LEARNER_STATUS_FIELDS = [
  {
    key: 'is_pwd',
    label: 'Person with disability (PWD)',
    // Mirrors the template column this is imported from.
    templateLabel: 'Is the learner a person with disability (PWD)',
    visibleToRoles: ['admin', 'principal', 'registrar', 'guidance_counselor', 'adviser', 'subject_teacher'],
  },
  {
    key: 'is_4ps',
    label: '4Ps recipient',
    templateLabel: '4Ps Recipient',
    visibleToRoles: ['admin', 'principal', 'registrar', 'guidance_counselor'],
  },
  {
    key: 'is_als_graduate',
    label: 'ALS graduate (Alternative Learning System)',
    // Not in the school's template — set manually, or inferred on import
    // from the free-text "Last School Attended" column and then confirmed.
    templateLabel: null,
    visibleToRoles: ['admin', 'principal', 'registrar', 'guidance_counselor', 'adviser', 'subject_teacher'],
  },
];

const LEARNER_STATUS_KEYS = LEARNER_STATUS_FIELDS.map((f) => f.key);

// Students never see any of these about themselves — the My Profile view
// is deliberately absent from every visibleToRoles list above, so this
// needs no special case anywhere. Spelled out here because "the student
// role simply isn't in the list" is easy to miss when reading the config.
function fieldsVisibleTo(role) {
  return LEARNER_STATUS_FIELDS.filter((field) => field.visibleToRoles.includes(role)).map((field) => field.key);
}

function canSeeField(role, key) {
  const field = LEARNER_STATUS_FIELDS.find((f) => f.key === key);
  return Boolean(field && field.visibleToRoles.includes(role));
}

module.exports = { LEARNER_STATUS_FIELDS, LEARNER_STATUS_KEYS, fieldsVisibleTo, canSeeField };
