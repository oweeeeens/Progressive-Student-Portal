# Sample import files

Two spreadsheets for demonstrating the bulk importers, and the script that
builds them.

They are matched to the **demo data** the seed scripts create — 36 learners
with LRNs `100000000001`–`100000000036`, sections `STEM A` / `STEM B` /
`ABM A`, school year 2026-2027 — so they work against a freshly seeded
database and against the Railway demo deployment without editing.

Regenerate with `node samples/generate-samples.js`. Edit the arrays at the
top of that file if the demo data ever changes.

---

## `students-import-sample.xlsx` — Students → Bulk Import

11 rows: **8 that import cleanly, 3 that are deliberately wrong.**

The bad rows are the point. A file where everything passes demonstrates less
than one where the mistakes are caught, named by row, and the good rows
import anyway — which is what the importer is actually for.

| Row | What it shows |
|---|---|
| 4 | An 11-digit LRN → *"LRN must be exactly 12 digits."* This is the classic spreadsheet failure: a leading zero eaten because the cell was formatted as a number. |
| 7 | An LRN already in the system → *"A student with this LRN already exists."* |
| 10 | Section written as `Grade 11 - ABM A`, the way it reads in the UI, rather than the section's own name `ABM A` → *"Section … was not found."* |

Row 6 also exercises the **ALS confirmation**: its "Last School Attended"
names an ALS centre, so the importer pre-ticks *ALS graduate* and asks a
human to confirm rather than trusting its own guess at free text.

New learners use LRNs in the `3100000000xx` block, well clear of the seeded
range, and all columns match the downloadable template exactly, so every
field auto-maps on the first screen with no manual correction.

## `sf2-attendance-sample.xlsx` — Attendance → Bulk Import

A DepEd SF2 for **Grade 11 – ABM A, October 2026**: a header block, a row of
day numbers, one row per learner, a mark in each cell. The importer finds the
LRN column by counting twelve-digit values and the day row by looking for the
longest ascending run of 1–31, so the header block is skipped without the
parser having to recognise any of it.

Four things are built in deliberately:

- **1 and 2 October are already recorded** in the demo data, so the import
  stops and asks, per day, whether to overwrite the existing record or skip
  it. That decision is the most defensible thing in the feature and is
  invisible on a file that happens not to overlap.
- **A stray `H` mark**, so the importer refuses to guess and asks what it
  means before writing anything.
- **One learner from STEM A**, reported as not belonging to this section
  rather than filed into the wrong register.
- **One learner listed twice**, reported, with the first row winning.

Import it as the ABM A adviser (`adviser3@studentportal.local`) or as an
admin or registrar.
