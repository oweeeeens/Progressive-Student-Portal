# `models/` — the database layer

One file per entity. A model owns the SQL for its table and nothing else: no
HTTP, no `req`/`res`, no business rules. If a function here takes a `req`,
it is in the wrong folder.

The split exists so that a question like "what does this app ever write to
`grades`?" is answerable by reading one file.

## What belongs here

- Queries, and the parameter binding around them.
- Shaping a result into the object callers expect (a `Map` keyed by LRN, a
  `{ records, summary }` pair).
- Transactions, where several statements must land together — see
  `attendanceImportModel.commitImport`, the clearest example.

## What does not

- **Authorization.** A model returns what it is asked for. Deciding whether
  this user may ask is the controller's job. The one deliberate exception is
  `studentModel`'s scope clause (below), which is a `WHERE` fragment rather
  than a decision.
- **Response shaping for a role.** `stripLearnerStatus` lives in `utils/` and
  is applied at the controller edge, because the same row is legitimately
  allowed to carry different fields depending on who asked.

## The ones worth knowing about

- **`studentModel`** — holds `appendScopeClause`, the per-role `WHERE`
  fragment that is this system's primary privacy boundary for minors'
  records: adviser → own section, subject teacher → classes they teach,
  student → themselves, unknown role → `FALSE`. It fails closed on purpose.
  Also `resolveSchoolYearId`, which every per-period query goes through.
- **`gradeModel`** — the approval chain. Each transition is a single
  statement with the expected prior status in its `WHERE`, so two people
  acting at once cannot produce a state that skipped a step.
- **`dailyAttendanceModel`** — the official SF2 register, and the only
  attendance the risk formula reads. `subjectAttendanceModel` is its
  per-class sibling and never feeds risk.
- **`riskAssessmentModel`** — stores the computed snapshot. The computing
  itself is in `services/`.
- **`attendanceImportModel`** — the one place that opens a transaction by
  hand, because an import covers a month and must not land half-written.

## Series queries and the school year

Anything that returns one row per grading period takes a `schoolYearId` and
filters on it. `grading_periods.sequence_number` is unique only *within* a
school year, so a learner in their second year has two periods numbered 1.
An unscoped series silently mixes the two. This is not optional.
