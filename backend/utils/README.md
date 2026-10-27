# `utils/` — small shared helpers

No feature owns these. Each is here because more than one place needs it and
the two must not drift.

- **`password.js`** — bcrypt hashing, temp-password generation, and the
  SHA-256 hashing of reset tokens before they are stored. Nothing outside
  this file touches a raw password or calls bcrypt directly.
- **`learnerStatusVisibility.js`** — both halves of the learner-status rule:
  stripping fields a role may not *see* from a response, and stripping
  fields it may not *set* from a request. The write half lives here rather
  than in a controller because the single-student form and the bulk importer
  both have to apply it — the importer used to skip it, which made bulk
  upload a way around the restriction.
- **`schoolDate.js`** — today's date in the school's timezone. The school is
  at UTC+8, so a UTC date names yesterday for the whole morning, and on a
  quarter boundary that is the wrong grading period.
- **`envNumber.js`** — reading numbers from the environment safely. See
  `config/README.md`.
- **`spreadsheetCell.js`** — flattening an ExcelJS cell (dates, formulas,
  rich text) into a plain string. Shared by both importers.
- **`fileStorage.js`** — saving an upload under a generated name.
- **`studentValidation.js`** — the student-record rules. The single-record
  form uses `validateStudentInput` wholesale; the bulk importer has its own
  per-column validator but imports `EMAIL_PATTERN` and `LRN_PATTERN` from
  here, so the two paths at least agree on what an LRN and an email look
  like. Worth unifying further: the importer currently restates some rules
  the form already has.
