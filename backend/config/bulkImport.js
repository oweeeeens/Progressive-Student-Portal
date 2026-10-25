// Single source of truth for the bulk student import feature: which of our
// student fields can be mapped to, which are required, the synonym list
// used to auto-detect a likely match for each uploaded column header, and
// the upload constraints. Kept separate from logic (services/bulkImport*.js)
// per CLAUDE.md's code quality standards — a new synonym or a changed limit
// never means touching the parsing/validation code itself.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — a spreadsheet of a few thousand rows is still well under this
const MAX_ROWS = 1000; // a school's SHS population realistically fits well within this; guards against an accidental multi-sheet/huge-file upload
const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
];

// The student fields an uploaded column can be mapped to. `required: true`
// fields must be mapped before validation can run at all — everything else
// is optional and simply stays null/unset on the created record if left
// unmapped. Order here is also the display order on the mapping screen.
const IMPORTABLE_FIELDS = [
  { key: 'lrn', label: 'LRN', required: true },
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'middleName', label: 'Middle Name', required: false },
  { key: 'lastName', label: 'Last Name', required: true },
  { key: 'sex', label: 'Sex (M/F)', required: false },
  { key: 'dateOfBirth', label: 'Date of Birth', required: true },
  { key: 'address', label: 'Address', required: false },
  { key: 'email', label: 'Personal Email', required: false },
  { key: 'guardianName', label: 'Guardian Name', required: false },
  { key: 'guardianContactNumber', label: 'Guardian Contact Number', required: false },
  { key: 'section', label: 'Section', required: false },
  // Learner-status reporting flags. The first two come straight from the
  // school's Student Information template; see config/learnerStatus.js.
  { key: 'isPwd', label: 'PWD', required: false },
  { key: 'is4ps', label: '4Ps Recipient', required: false },
  // NOT a column in the template. It's mappable anyway in case a school
  // adds one, but its real source is lastSchoolAttended below.
  { key: 'isAlsGraduate', label: 'ALS Graduate', required: false },
  // Imported for ONE purpose and never stored: it's the free-text column
  // "ALS" is matched against to pre-fill isAlsGraduate. Because that match
  // is a guess against prose a clerk typed, every row it fires on is
  // flagged for confirmation rather than silently trusted.
  { key: 'lastSchoolAttended', label: 'Last School Attended (used to detect ALS)', required: false },
];

// Normalized (lowercase, trimmed, whitespace-collapsed) header text that
// auto-maps to each field. Checked for an exact match first, then as a
// substring, against every uploaded column header — see
// services/bulkImportParser.js's suggestMapping.
const COLUMN_SYNONYMS = {
  lrn: ['lrn', 'learner reference number', 'learner reference no', 'lrn no', 'lrn number'],
  firstName: ['first name', 'firstname', 'given name'],
  middleName: ['middle name', 'middlename'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  sex: ['sex', 'gender'],
  dateOfBirth: ['date of birth', 'birthdate', 'birth date', 'dob'],
  address: ['address', 'home address'],
  email: ['email', 'email address', 'personal email'],
  guardianName: ['guardian name', 'guardian', 'parent name', "parent's name"],
  guardianContactNumber: ['guardian contact', 'guardian contact number', 'contact number', 'parent contact', "guardian's contact number"],
  section: ['section', 'section name', 'class', 'advisory section'],
  isPwd: [
    'is the learner a person with disability (pwd)',
    'person with disability',
    'pwd',
    'is pwd',
    'learner with disability',
  ],
  is4ps: ['4ps recipient', '4ps', 'is 4ps', '4p s recipient', 'pantawid', '4ps beneficiary'],
  isAlsGraduate: ['als graduate', 'als', 'alternative learning system'],
  lastSchoolAttended: ['last school attended', 'previous school', 'school last attended', 'last school'],
};

const TEMPLATE_FILENAME = 'student-import-template.xlsx';

module.exports = {
  MAX_FILE_SIZE_BYTES,
  MAX_ROWS,
  ALLOWED_MIME_TYPES,
  IMPORTABLE_FIELDS,
  COLUMN_SYNONYMS,
  TEMPLATE_FILENAME,
};
