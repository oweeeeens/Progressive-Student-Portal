# models/

Each file here owns the database queries for one entity (e.g. `studentModel.js`,
`attendanceModel.js`), following the same one-concern-per-file pattern as
`routes/` and `controllers/`. All queries go through the shared pool exported
by `config/db.js`.

Empty for now — Phase 1 build order starts with Auth and Student Records
(see root `CLAUDE.md`), so the first real model files land with those modules.
