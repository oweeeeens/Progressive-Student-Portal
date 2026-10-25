// Field-level validation rules for a student record — shared between the
// single-student form (studentController.js) and the bulk-import validator
// (services/bulkImportValidator.js) so the two paths can never silently
// disagree about what counts as a valid student row.
const LRN_PATTERN = /^\d{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SEX = ['M', 'F'];
const VALID_ENROLLMENT_STATUS = ['pending', 'enrolled', 'dropped', 'transferred', 'graduated'];

// Validates the fields present in `data` (camelCase keys, matching
// studentModel's own field names). When `partial` is true (PATCH), fields
// that are simply absent are skipped rather than treated as missing.
// Returns an array of plain-English error strings — callers that need
// field-level detail (bulk import) instead call the individual check*
// functions below directly.
// Descriptive reporting flags — booleans, never strings. Checked because
// a spreadsheet-shaped "Yes" arriving here would otherwise be stored as a
// truthy value without anyone noticing (the bulk importer normalises those
// before they reach this point — see bulkImportValidator's parseBoolean).
const LEARNER_STATUS_INPUT_KEYS = ['isPwd', 'is4ps', 'isAlsGraduate'];

function validateStudentInput(data, { partial = false } = {}) {
  const errors = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(data, key);

  for (const key of LEARNER_STATUS_INPUT_KEYS) {
    if (has(key) && typeof data[key] !== 'boolean') {
      errors.push(`${key} must be true or false.`);
    }
  }

  if (!partial || has('lrn')) {
    if (!data.lrn || !LRN_PATTERN.test(data.lrn)) {
      errors.push('lrn must be exactly 12 digits (DepEd Learner Reference Number).');
    }
  }
  if (!partial || has('firstName')) {
    if (!data.firstName || !data.firstName.trim()) errors.push('firstName is required.');
  }
  if (!partial || has('lastName')) {
    if (!data.lastName || !data.lastName.trim()) errors.push('lastName is required.');
  }
  if (!partial || has('dateOfBirth')) {
    const date = new Date(data.dateOfBirth);
    if (!data.dateOfBirth || Number.isNaN(date.getTime()) || date > new Date()) {
      errors.push('dateOfBirth must be a valid past date (YYYY-MM-DD).');
    }
  }
  if (has('sex') && data.sex && !VALID_SEX.includes(data.sex)) {
    errors.push(`sex must be one of: ${VALID_SEX.join(', ')}`);
  }
  if (has('enrollmentStatus') && data.enrollmentStatus && !VALID_ENROLLMENT_STATUS.includes(data.enrollmentStatus)) {
    errors.push(`enrollmentStatus must be one of: ${VALID_ENROLLMENT_STATUS.join(', ')}`);
  }
  if (has('currentSectionId') && data.currentSectionId !== null && !Number.isInteger(data.currentSectionId)) {
    errors.push('currentSectionId must be an integer or null.');
  }
  if (has('email') && data.email && !EMAIL_PATTERN.test(data.email)) {
    errors.push('email does not look like a valid email address.');
  }

  return errors;
}

module.exports = {
  LRN_PATTERN,
  EMAIL_PATTERN,
  VALID_SEX,
  VALID_ENROLLMENT_STATUS,
  validateStudentInput,
};
