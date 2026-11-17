# Official templates

## `deped-school-forms-2013.xlsx`: DepEd School Forms (SF1–SF7)

This is DepEd's own workbook, copied **byte for byte and never edited**.
`scripts/testSf2Template.js` checks its SHA-256, which starts with
`710676199e88e9b811c2`.

**Where it comes from:**
- Download: https://catanduanes.deped.gov.ph/new-school-forms.html, file
  `School-Forms-Spread-sheet.xlsx`, published by the DepEd Division of
  Catanduanes.
- The file's author is "Deped". It was created in July 2012 and last
  modified in September 2013.

**What it is:**
- These are the modified School Forms adopted under **DepEd Order No. 4,
  s. 2014**.
- They are prepared and checked under **DepEd Order No. 11, s. 2018**.
- The same SF2 layout appears in the division's PDF:
  https://catanduanes.deped.gov.ph/files/SF2-Daily-Attendance-Report-of-Learners.pdf

**How the System uses it:** `services/sf2Template.js` serves the
**"School Form 2 (SF2)"** sheet as the attendance-import template, through
`GET /api/attendance/bulk-import/template`.

**What it changes.** It fills only the form's blank cells:
- School Year, Month, Name of School, Grade Level and Section;
- the dates and day letters in rows 11–12;
- the learners' names, males in rows 14+ and females in rows 36+.

It also removes the other six sheets. When a section has more learners than
the form's 21 male or 25 female rows, it inserts extra rows in that block,
and every merge and drawing below them moves down with it.

**What it leaves alone:** the guidelines, codes, summary, signatures, logos
and print setup.

**What the form does not have:**
- **No School ID.** The System does not store one, so the adviser fills it
  in.
- **No LRN column.** That is why the attendance import matches learners by
  name (`services/learnerNameMatch.js`).
