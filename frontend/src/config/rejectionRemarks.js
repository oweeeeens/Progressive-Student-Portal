// Suggested remarks the principal can click when rejecting a submitted grade
// (Verify Grades). Clicking one puts it in the note box, where it can still
// be edited, so these are starting points, not a fixed list of reasons — the
// note itself stays required, both here and on the server
// (gradeController.rejectGrades), because the subject teacher reads it on
// Enter Grades to know what to fix.
//
// Kept in one config file, apart from the page, so the school can reword or
// add to them without touching the page logic.
export const REJECTION_REMARKS = [
  'The grade does not match the class record. Please recheck and resubmit.',
  'Please recompute the grade from the written work, performance tasks, and term assessment scores.',
  'The grade appears to be entered for the wrong student or subject. Please verify.',
  "This grade is inconsistent with the student's other records. Please confirm it before resubmitting.",
  "Please submit the class record to the principal's office for checking, then resubmit.",
]
