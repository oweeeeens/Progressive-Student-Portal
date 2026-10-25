// Intervention type/status vocabulary, in one place.
//
// The type list was previously a literal inside interventionModel.js; it
// moved here when the Analytics export needed the matching DISPLAY LABELS
// too (for the PDF and the workbook). Keeping the keys and their labels
// side by side means a new intervention type can't be added to the enum
// without its label being obviously missing right next to it.
//
// These keys must stay in sync with the `intervention_type` /
// `intervention_status` Postgres enums (see the create-interventions
// migration) — the database is the real constraint, this is the
// application-side mirror used for validation and presentation.
const INTERVENTION_TYPES = ['parent_conference', 'tutoring_referral', 'counseling_referral', 'attendance_follow_up', 'other'];

const INTERVENTION_TYPE_LABELS = {
  parent_conference: 'Parent Conference',
  tutoring_referral: 'Tutoring Referral',
  counseling_referral: 'Counseling Referral',
  attendance_follow_up: 'Attendance Follow-up',
  other: 'Other',
};

const INTERVENTION_STATUSES = ['open', 'monitoring', 'resolved', 'escalated'];

const INTERVENTION_STATUS_LABELS = {
  open: 'Open',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  escalated: 'Escalated',
};

module.exports = {
  INTERVENTION_TYPES,
  INTERVENTION_TYPE_LABELS,
  INTERVENTION_STATUSES,
  INTERVENTION_STATUS_LABELS,
};
