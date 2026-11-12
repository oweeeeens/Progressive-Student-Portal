# Project: Student Portal System with Trend-Based Academic Risk and Intervention Tracking Dashboard

## Overview
A web-based student portal for **DepEd Progressive Senior High School – Bacoor City**, a public DepEd school. Built as a capstone project (ITEC 200-A, Cavite State University – Imus Campus) by Dodge Carlson Paolo B. Bautista, Mark Cyrus S. Supan, and Paul Owen J. Havana, advised by Grace S. Ibañez, MSCS.

The system replaces manual, paper-based record keeping with a centralized digital portal, and adds a risk-detection layer that flags students whose grades/attendance are declining, then tracks whether adviser interventions actually helped.

## Tech Stack
- Frontend: React
- Backend: Node.js / Express
- Database: PostgreSQL. Using `embedded-postgres` (npm) for local development due to installer restrictions in the dev environment — this is a real local Postgres instance, not a mock. Switch to a hosted provider (e.g. Supabase, Railway) before client deployment by setting `USE_EMBEDDED_DB=false` and updating the `PG*` env vars — no code changes needed.
- Auth: Email/password-based (students use personal email — no school Gmail/Workspace accounts available)

## Scope (Phase 1 — do not expand beyond this without discussion)
1. **Student Records Management** — centralized digital student info (replaces paper files/Excel)
2. **Attendance Tracking** — daily/homeroom attendance, manually input (no QR/RFID/biometric scanning), logged by the adviser (the official DepEd SF2 record); the record used for the risk formula's attendance rate. (A second, subject-level register existed until 2026-11-11 — see REMOVED below.)
3. **Trend-Based Academic Risk & Intervention Tracking Dashboard** (the innovation — see below)

## REMOVED: Announcements, Subject Attendance, Report Card PDF (as of 2026-11-11)
The research adviser asked the group to remove every module the **title** does
not cover — "Web-Based Student Portal with Trend-Based Academic Risk
Analytics and Intervention Monitoring Dashboard" — and keep the System simple.
The group chose three:

1. **Announcements, and the ICT Faculty role.** The role existed only to post
   announcements. Its value stays in the `user_role` enum (Postgres cannot drop
   an enum value without rebuilding the type), but it is gone from
   `USER_ROLES`/`CREATABLE_ROLES` in `backend/config/auth.js`, the migration
   deactivated every such account, and a test asserts it can be neither
   created nor assigned.
2. **Subject-level attendance**, including the subject half of the attendance
   import. It never fed the risk score — only the adviser's daily SF2 record
   does — so nothing about risk changed.
3. **Report Card PDF.** Grades remain viewable on screen; the official card
   stays the school's existing process. `services/pdfPrimitives.js` stays for
   the Analytics PDF.

Migration `20261111090000000_narrow-scope-to-title.sql` drops
`announcements` and `subject_attendance_records` (13 tables remain) and
removes the subject-import audit rows. Its down migration recreates the
tables **empty**. Kept deliberately, by the group's choice: learner-status
fields, forgot-password by email, both bulk imports, the home task list, and
Analytics (risk analytics is in the title).

**For the thesis manuscript:** the same framing as the Enrollment removal — a
documented scope reduction at the adviser's direction to keep the study on
its title. Announcements were client-requested, so the Limitations section
says so and notes the school keeps its existing noticeboard.

Older sections below still describe these features where they explain how
something else came to be built; read them as history.

## REMOVED: Enrollment Management (as of 2026-10-08)
The client requested removing digital enrollment entirely — they want to keep their existing **paper/hard-copy** enrollment process (report card, birth certificate, SF10 submitted physically), not digitized through the portal.

**Remove from the system:**
- Enrollment document upload/review feature, Enrollment Queue page, enrollment-related stat cards on the Dashboard, the Enrollment sidebar section

**Important dependency to fix:** student portal accounts were previously **auto-created** when `enrollment_status` flipped to `enrolled` via the Enrollment module. That trigger no longer exists. Student accounts now follow the same path as staff accounts: **registrar/admin manually creates the student's account** (using the account-creation flow already built for staff) after the student's record is added to Student Records, once the student has enrolled on paper.

**For the thesis manuscript:** this is a legitimate, documentable scope reduction — frame it in Chapter 1/Methodology as: the system initially scoped digital enrollment management, but the client opted to retain their existing paper-based enrollment process, so scope was narrowed to records, attendance, grades, and risk/intervention monitoring. The system now assumes a student has already been enrolled on paper before their record is added to the portal.

## User Roles & Access
- **Admin** — manages accounts (registration is admin-only, no public self-signup)
- **Principal** — verifies/approves grades submitted by subject teachers (see Grade Approval Workflow below). One school-wide position, so they also *read* school-wide: Analytics, the Academic Progress Tracking dashboard, student records, and **Academic Setup — read-only** (school years, sections, subjects, class offerings, grading periods). The structure of the school year is theirs to see; restructuring it stays with the admin, and those four pages hide their write controls rather than letting them fail with a permission error. They hold no advisory section and teach no class, so the attendance and grade-entry pages are not shown to them. Logging interventions stays with advisers and guidance counselors — the principal approves grades and reads the rollup; the per-learner follow-up is not theirs.
- **Advisers** — see only students in their own advisory section; finalize grades into the official record (final step of the approval workflow)
- **Subject teachers** — submit initial grades for the classes they actually teach (scoped by class/subject, not by advisory section — a teacher may teach students across multiple sections)
- **Guidance counselors** — view flagged/at-risk students (Academic Progress Tracking, Analytics). **Read-only since 2026-11-12: they no longer log or see interventions** (see Part B, "adviser only")
- **Registrar staff** — manage student records; create student/staff portal accounts once a student has enrolled on paper (see REMOVED: Enrollment Management above)
- ~~**ICT faculty**~~ — **removed 2026-11-11** with Announcements, the only thing the role did (see REMOVED above).
- **Students / Parents** — view own records only (no separate parent role yet — out of scope for Phase 1, students role covers this access level)

**One person can hold two kinds of assignment.** A teacher commonly advises
one section *and* teaches subjects to other sections, and the system must
represent that: `sections.adviser_id` and `class_offerings.teacher_id` are
plain user references with no role constraint, and **every** permission
decision asks what you are assigned to, never what your role column says.
Both `adviser` and `subject_teacher` are therefore offered in both pickers in
Academic Setup.

This was written the other way round until 2026-11-03, and the contradiction
had consequences. Read scope (`studentModel.appendScopeClause`) was a switch
on the role label with a `return` in every branch, so exactly one predicate
could apply — while every write guard was already assignment-based. An
adviser who also taught could submit a student's grade and then not be
allowed to open that student's record: 404 on the detail page, no attendance
history, no report card, and missing from the roster entirely. Two guards
written `if (role === 'adviser')` also let anyone who advised a section under
a different role label fall through to school-wide risk data.

A role change is still refused while the user holds assignments **when the
new role could not hold them** — moving someone out of teaching entirely
would otherwise leave a registrar with write access to a section's register.
Moving between `adviser` and `subject_teacher` is free.

**The demo data now shows this on every adviser.** Until 2026-11-04 only one
of the three seeded advisers taught anything, so two of them had no Enter
Grades and no Subject Attendance — the navigation telling the truth about
data that did not reflect the school. Each adviser now teaches one subject
into a section they do **not** advise (`TEACHER_OVERRIDES` in
`demoDataset.js`). A bug surfaced while doing it: `seedDemoAcademicData.js`
built its offering lookup from the subjects' DEFAULT teachers only, so any
offering reassigned by an override belonged to somebody it never signed in
as — the class was filtered out and received no grades and no subject
attendance at all. ABM A's Personal Development had silently been in that
state since the first override was added.

**Navigation is driven by assignment, not by role label.** Write access to
the attendance and grade pages is decided by `sections.adviser_id` and
`class_offerings.teacher_id`, so the role alone cannot say whether a page has
anything in it. `AuthContext` counts the signed-in user's own sections and
class offerings once per session and the sidebar hides any link whose count is
zero — so an adviser who teaches nothing is not offered Enter Grades, and a
subject teacher who advises nothing is not offered Finalize Grades. If those
counts fail to load the sidebar falls back to showing every role-eligible
link, which is only a cluttered menu: the server is the real boundary.

**Note on who can reset a password.** Only **admin** and **registrar** can create accounts or issue a temporary password (`CREATABLE_ROLES` in `backend/config/auth.js`, and `canWrite` in `backend/routes/userRoutes.js`). Advisers cannot — the forgot-password fallback text says so, and must keep saying so, since with email unconfigured that is the only recovery route a user has.

**Admin accounts are special.** `admin` is never offered on any account-creation form and can never be assigned or removed by editing an account. Beyond that, an admin account may only be acted on by *that same admin* — no other role, and no second admin, can reset its password, change its email or deactivate it. Without that last rule a registrar could reset the admin's password, read it out of the response, and sign in as admin.

## Grade Approval Workflow (confirmed with client)
Grades are NOT entered directly by one person. They go through a 3-stage approval chain:
1. **Subject teacher** creates/submits a grade (initial entry — status: Submitted)
2. **Principal** reviews and verifies it (status: Principal-Verified) — the Principal is one person for the whole school, not a per-subject role
3. **Adviser** inputs the grade into the student's official record (status: Finalized — this is the "official" grade)

- **Rejection handling:** if the Principal rejects a submitted grade, it returns to the Subject Teacher to resubmit (status reverts to Submitted / or a Rejected status with a resubmit action)
- **Suggested remarks (2026-11-12):** the reject form offers clickable ready-made remarks (`frontend/src/config/rejectionRemarks.js`) that fill the note, which stays editable and required — the teacher reads it on Enter Grades. They are starting points, not a fixed reason list, so nothing about the stored data changed.
- **A finalized grade is final.** Once the adviser has put a grade into the official record, a subject teacher resubmitting it does *not* take it back to Submitted — the resubmission is refused for that row and the teacher is told why. Without this, a resubmit silently reverted the official grade to a draft and erased who finalized it and when, while the stored risk score went on citing a grade that no longer counted. Correcting a finalized grade is deliberately an adviser's action, not a teacher's.
- **Risk formula uses only Finalized grades** (post-adviser-input), not grades still in Submitted or Principal-Verified status. Note: this means risk detection may lag behind real-time classroom performance due to the approval pipeline — call this out explicitly as a known limitation in the thesis manuscript (Scope and Limitations chapter), framed as working within the school's existing grade-approval process rather than bypassing it.

## Academic Progress Tracking Logic (Part A)
As of 2026-10-16, the module formerly called "Risk Dashboard" throughout the UI/routes/docs is renamed **Academic Progress Tracking**. This is a presentation/data-model expansion only — the risk-scoring formula below is completely unchanged. The dashboard now shows every student in scope by default, grouped into three performance bands, not just the ones flagged as at-risk.

Recalculated whenever new grades/attendance are entered (not real-time).

Per grading period (per term), track each student's:
- Average grade
- Attendance rate

**Trend (rate of change) formula:**
```
Trend = (Most Recent Value − Earliest Value) / Number of Periods
```

**Risk scoring formula (unchanged):**
```
IF current grade < 75            → +2   (DepEd at-risk threshold)
IF grade trend ≤ -5/period       → +2   (declining fast)
IF current attendance < [TBD]%   → +2   (attendance threshold pending from client)
IF attendance trend ≤ -5%/period → +2   (declining fast)

0-2 → Low Risk
3-5 → Medium Risk
6+  → High Risk
```
Note: Attendance risk threshold is still pending confirmation from the client (DepEd Order referenced but not yet provided) — use placeholder until confirmed, make this value configurable/easy to change.

**Where that pending value lives:** `ATTENDANCE_RISK_THRESHOLD` in the environment, defaulting to 90 (`backend/config/riskConfig.js`), documented in `backend/.env.example`. When the client confirms the real figure it is one env var and a restart, with no code change. A malformed value falls back to 90 and warns, rather than becoming `NaN` and silently switching the factor off. **Changing it does not retroactively rescore stored assessments** — those are recalculated the next time that student's grades are finalized or their attendance is recorded.

**Performance bands (new, built on top of the unchanged risk score above):**
Every student is classified into exactly one of three bands per grading period:
1. **At Risk** — any risk factor triggered (risk score > 0, Low/Medium/High exactly as above). Shows which specific factor(s) triggered plus a short, rule-based advisory message tied to each one (e.g. a declining grade trend suggests a tutoring referral; low attendance suggests an attendance follow-up).
2. **Average / Steady** — no risk factors triggered, but not clearly excelling either. Neutral status with a brief encouragement note.
3. **Performing Well** — no risk factors triggered AND (current average grade ≥ 90, DepEd's "Outstanding" band, OR a grade trend improving by ≥ 5 points/period). Gets a recognition/reward badge.

Advisory/encouragement/recognition text is **rule-based** (a fixed message per triggered factor, configured in `backend/config/academicProgress.js`), not AI-generated — kept deterministic and explainable for the same reason the risk formula itself is, and to avoid sending minors' academic data to a third-party service. See `backend/services/academicProgressCalculator.js` for the band/advisory logic, layered on top of (not modifying) `riskCalculator.js`.

## Intervention Tracking Logic (Part B — the closed loop)

**Adviser (and admin) only, no third parties (2026-11-12; admin restored 2026-11-13 at the group's request).** The instructor and research
adviser ruled that a learner's interventions involve **only that learner's
adviser**: the person in `sections.adviser_id` for the learner's current
section. Logging, changing status, and reading the record and its notes are
all theirs alone.
- **Also allowed:** the **admin**, with full access as the system's
  administrator (school-wide list, notes, log and update).
- **Refused:** principal, guidance counselor, and a teacher who only
  teaches the section. All get 403, or an empty list and zero counts.
- **Still allowed:** everyone else sees **anonymous totals** on Analytics.
  The learner still sees their own on My Progress, because they are the
  data subject.

**Grounds:**
- **DepEd's Homeroom Guidance Program:** the class adviser follows up their
  own learners and refers to the guidance counselor only when counseling is
  needed. In the System that referral is recorded by the adviser as a
  "Counseling Referral".
- **Data Privacy Act (RA 10173), Sec. 11 — proportionality.**
- **RA 9258:** counseling itself is for licensed counselors. The System only
  records the referral.

**Implementation:**
- `studentModel.isAdvisedBy` and `appendAdviserOnlyClause`.
- No `requireRole` on the intervention routes: advising is an assignment,
  not a role.
- `canLogIntervention` on Academic Progress rows.
- The sidebar link is earned by advising a section.
- The activity feed and home-task counts are scoped to advisory learners.

**Tests:** `test/integration/interventionAccess.test.js`.

When a student is flagged, their adviser logs an intervention:
- Fields: intervention type (Parent Conference / Tutoring Referral / Counseling Referral / Attendance Follow-up / Other), notes, date logged
- Status: **Open → Monitoring → Resolved / Escalated**
- On next grading period's risk recalculation, auto-compare new risk level to the risk level at time of intervention:
  - Improved → mark **Resolved**
  - Same/worse → mark **Escalated**

## Modules Built (map — what exists and how it connects)

CLAUDE.md's Code Quality Standards ask for per-module orientation notes. Each backend folder now carries its own `README.md`; this is the one-screen version. Everything below is built and tested unless stated.

**Core chain (build order).** Auth → Student Records → Attendance → Grades → Academic Progress Tracking → Intervention Tracking. Each depends on the one before; the risk dashboard is meaningless without grades and attendance in place.

**Also shipped, beyond the original Phase 1 list:**

- **Bulk Student Import** — an .xlsx of student records, mapped column by column to our fields. Four steps (upload → match columns → review → done), stateless between them. `services/bulkImportParser.js` reads the file, `services/bulkImportValidator.js` decides what is importable, `controllers/bulkImportController.js` drives it. Re-validates server-side on commit, including the learner-status write gate.
- **Bulk Attendance Import** — the school's existing DepEd SF2 spreadsheets: learners down the side, school days across the top, a mark per cell. A different shape from the student import, so it has its own grid parser (`services/attendanceGridParser.js`). Five steps, and a day that already has attendance takes an explicit overwrite-or-skip decision. Writes the daily register, so it triggers the same risk recalculation the marking sheet does — once per grading period, never once per date. Every imported mark records which import wrote it (`import_id`), and correcting a day by hand clears that attribution.
- **Analytics** — the school-wide rollup of risk, factors, attendance and intervention effectiveness, with PDF and Excel export. Admin, principal and guidance counselor only; advisers keep the per-section Academic Progress view instead. `services/analyticsCalculator.js` does the maths, `analyticsReportPdf.js` / `analyticsReportWorkbook.js` render it.
- ~~**Report Card PDF**~~ — removed 2026-11-11 (see REMOVED above).
- **My Progress** (student self-view) — a student's own grades, attendance, risk band and the plain-language version of any triggered factors, including what number they would have to reach to clear each one. Read-only and scoped to themselves; no school-wide figures reach it.
- **Your profile** (`/profile`, every role) — the one page a person owns: their
  name and email, their password, and what they advise and teach. The
  assignment panel calls **both** `/sections/mine` and `/class-offerings/mine`
  every time rather than branching on the role label, so a teacher who advises
  one section and teaches another sees both — the presentation half of the
  scoping rule above. An **email change requires the current password**, for
  every role including admin: whoever controls the address controls password
  recovery, so that field is a credential wearing a profile field's clothes.
  Nothing else about the account is reachable from `PATCH /api/auth/profile` —
  the id comes from the token and `role` is not a field it reads.
- **Learner Status fields** (`is_pwd`, `is_4ps`, `is_als_graduate`) — DepEd reporting fields on the student record. **Descriptive only: they never feed the risk formula.** Visibility is per field and per role (`backend/config/learnerStatus.js`): a subject teacher may see a disability flag because they teach the learner, but not 4Ps status, which is household financial information. Students never see any of the three about themselves. The same map gates writes, not just reads.

## The Home Page Is About The Person Looking At It (2026-11-04)

The staff landing page was organised **by content type**, and that is what
made it read as generated rather than designed. A registrar's exam-schedule
notice occupied the largest region of the page, in full, three times over.
Students Needing Attention — the entire point of this system — was 300px of
small text in a sidebar. Every block was the same white panel with a bold
heading, so nothing on it could lead. On a product whose innovation is
trend-based risk detection, it carried **no data visualisation at all**,
while `components/charts/` already held six chart components and a
measured-width layout helper.

It is organised **by priority** now, and the composition is **decided by the
data, not by a switch on the role**. Each block renders only if its own
(already role-scoped) data came back with something in it. That is what
shapes the page per role without a role table anywhere in it — and it is the
only approach that survives the school's ordinary case, a teacher who
advises one section and teaches into two others, because the scoping the
data was fetched under is assignment-based while a role label is not.

**1. The hero carries the term.** `StaffHero` adds how far through the
grading period the school is, with a meter and "41 weekdays left".
Deliberately *weekdays*, not *school days*: this schema holds no holiday
calendar, so calling them school days would be a claim the data cannot
support. Every other figure on the page is relative to the term, and working
out which week of the term it is was a question the page quietly left to
the reader.

**2. "What needs you today" leads the page** — `GET /api/dashboard/queue`,
`models/dashboardQueueModel.js`, vocabulary in `config/dashboardQueue.js`.
A list, not a third row of cards: these are tasks rather than figures, and a
row has somewhere to put the clause that says what its count includes. Each
row wears its **module hue** (grades amber, attendance teal, progress plum,
records indigo), which orients the reader *and* keeps the strip well clear
of the risk ramp — those reds mean "this learner is in trouble" and must
never be spent on "you have paperwork".

Three rules make it trustworthy:

- **Earned by assignment, not role label**, wherever the work is. The
  adviser items come from `sections.adviser_id` and the teaching items from
  `class_offerings.teacher_id`, so a teaching adviser gets both halves.
- **A count must be the number the linked page will show.** Where a figure
  already exists it is reused, never re-queried: the principal's backlog is
  `dashboardModel.countSubmittedGrades`, the temporary-password figure is
  `userModel.countAccounts` — exactly what User Management's own card
  counts. The queue links to `/users?tab=pending`, so the page it opens is
  the list it counted.
- **It invents no deadline the school does not have.** "Today's register is
  not marked" is only asked on a weekday inside a grading period, and every
  period-dependent count is *omitted* between terms rather than reported
  as zero — "0 grades to finalize" would read as caught up when the truth is
  that the question does not apply.

An empty queue and *no* queue are different states and are rendered
differently. A student is offered nothing, so nothing is drawn; somebody
who has cleared theirs is told so, and told which checks came back empty.

**3. The risk picture is promoted out of the sidebar**, as a band
distribution for this person's own scope (`GET /api/dashboard/bands`) beside
the flagged learners, each with the factor that fired. The chart is a bar
per band against one shared zero, **never stacked** — `BarChart`'s own
header states that rule and why. One term, not a trend: Analytics owns
over-time, and the movement since last term is said in a sentence
underneath instead. **No new colour was introduced anywhere in this work**:
the chart reuses the frozen, CVD-validated band tokens exactly (asserted
against their literal values in the browser check), and the task strip
reuses the already-validated module palette.

**4. (Removed 2026-11-11.)** This section described the announcements feed
and the ICT faculty noticeboard, both since removed — the page now ends with
the recent-activity feed.

**One shared file came out of it.** The band order, labels and colours lived
inside `AnalyticsPage.jsx`; they are now `utils/performanceBands.js`, shared
with the home page. Two copies of "which colour is At Risk — Medium" would
have drifted, and the same learner would have been a different colour on two
pages of one product.

## Class Record: Grades Are Computed, Never Typed (2026-11-12)

**The research adviser's objection:** a teacher typing a final grade into
Enter Grades is wrong. A grade must be computed from the learner's recorded
scores, and anyone reading it must be able to see the breakdown. DepEd says
the same. So **Enter Grades is gone**: `POST /api/grades` no longer exists,
and `/grades/entry` is now the **Class Record**
(`frontend/src/pages/ClassRecordPage.jsx`).

**Source: DepEd Order No. 015, s. 2026, Annex D**, pp. 35–39 (signed 4 June
2026; it replaces DO 8, s. 2015 and matches the school's three terms). Every
number was read from the signed scanned PDF itself, not from a summary. The
order's own worked examples (Table 5 gives 88; Table 6, zero-based, gives
84) are test cases in `scripts/testGradeCalculator.js`, and both pass. All
numbers live in `backend/config/gradingPolicy.js`:

- **Components.**
  - Written/Oral Works (WW).
  - Product/Performance Tasks (PT).
  - Examinations (EX) = Summative Test 1 (30%) + Summative Test 2 (30%) +
    Term Exam (40%). Field Exposure groups have a Term Exam only (¶7).
- **SHS weights (Table 2), per `subjects.weight_group`** (WW / PT / EX):
  - core 20/50/30;
  - academic elective 20/50/30;
  - arts, sports and wellness 20/60/20;
  - field exposure 15/70/15;
  - research and design 40/60/–;
  - TechPro elective 15/65/20;
  - work immersion 20/80/–.

  The admin sets the group on the Subjects form.
- **Steps.** Total raw score per component → PS = raw ÷ HPS × 100 → WS =
  PS × weight → Initial Grade = sum of the WSs → Term Grade.
  - PS and WS are rounded to two decimals at each step, so the breakdown on
    screen adds up exactly.
  - The Term Grade uses the **adjusted transmutation table for SY
    2026–2027** (Table 4: IG 70.00 → 75; 60 is the minimum reported grade).
  - `GRADING_MODE=zero_based` switches to no transmutation. The order
    schedules zero-based grading for SY 2027–28 for Grades 4–10 only and
    names no date for SHS, so it stays a switch.
- **Attendance and participation are NOT grade components.** The order
  grades only WW, PT and EX. Participation can count only if the teacher
  records it as a Performance Task item.
- **A blank is not a zero.** A learner with any score missing has no
  computed grade. The page names what is missing, and submit skips them.

**Data** (migration `20261112120000000_add-class-record.sql`, **15 tables
now**):
- `assessment_items`: class offering, term, component, exam part, title,
  highest possible score.
- `assessment_scores`: one learner's raw score on one item.
- `grades.computation` (JSONB): a snapshot of the breakdown taken at
  submission, so a grade on record always shows the figures it came from.
- `subjects.weight_group`.

**Flow.** The teacher records items and scores → the page previews each
learner's grade live (`utils/gradeCalculator.js`, fed DepEd's numbers by the
server's `policy`) → **Submit for review**, where the server recomputes from
the stored scores (`classRecordController.submitClassRecord`) and writes the
grade and its snapshot through the unchanged `gradeModel.upsertSubmittedGrades`.
- The approval chain and the risk formula did not change. Risk still reads
  only finalized `grade_value`.
- A finalized learner's scores, and the items behind them, are locked
  (409).
- **Who can read a record:** the teacher, the section's adviser, the
  principal and admin. **Who can write:** the teacher and admin. All of
  this is by assignment.

**The breakdown is shown everywhere a grade is**
(`components/GradeBreakdown.jsx`, the "View breakdown" action):
- Verify Grades;
- Finalize Grades;
- the staff Grades tab;
- the learner's My Grades.

**Demo data.** `npm run backfill:class-records` gave all 495 pre-existing
demo grades a class record. Its scores compute exactly to the grade each
learner already had: 0 failures, and no value or status changed.
`seedDemoAcademicData.js` now seeds through the Class Record API, using
`scripts/lib/demoClassRecord.js`.

**The backfill runs on every Railway deploy (2026-11-13).** It is run with
`--on-deploy` from `npm run deploy:prepare`, railway.json's pre-deploy step,
straight after migrations. That way the live demo shows class records
without anyone running a script by hand.
- **Safe to repeat:** it only touches grades whose `computation` is empty.
  Those can only be grades typed in before the Class Record existed, which
  are the demo grades. Every grade submitted since carries its breakdown, so
  after the first run each deploy is a no-op.
- **In deploy mode:** a failure is logged and the deploy continues.
- **Switch it off** with `BACKFILL_CLASS_RECORDS=false` once the school runs
  the System with real learners. Real grades get real scores, not generated
  ones.

**Then every current learner gets a record** —
`scripts/fillDemoClassRecords.js` (`npm run fill:demo-class-records`), the
next step of `deploy:prepare`. The backfill only builds a record behind an
existing grade, and on the live demo many learners had no grade in many
classes, so their Class Record stayed empty. For each active class this
school year, each term that has started, and each active learner with no
score yet:
- **Scores:** on the class's own items, or on DepEd-shaped demo items if the
  class has none for that term.
- **A term that has ended,** where the learner has no grade: the computed
  grade is entered as **Finalized**, with its breakdown, and risk is
  recalculated.
- **The current term:** scores only, so the grade is provisional and the
  teacher still submits it.
- **Never touched:** an existing grade or its approval trail. A second run
  does nothing.
- **Grades are deterministic:** near the learner's own average, otherwise
  about 70–95, with roughly one in six below 75.
- **Same rules as the backfill:** the same off switch, and the same "never
  blocks a deploy" behaviour.

**Tests:** `testGradeCalculator.js` (109 checks) and
`test/integration/classRecord.test.js`. The other suites now create grades
through `test/integration/helpers/classRecord.js`, which records scores that
compute to the wanted grade.

**Still to build:** the bulk import of the school's grade-computing
spreadsheet. It is waiting on a copy of the school's actual file, so that it
reads that exact layout and can cross-check the sheet's own computed grades
against ours.

## e-Class Record Import, the Learner's Full Record, and Learner Outlook (2026-11-13)

**The study's flow, in the group's words:** the school keeps its class
records in DepEd's e-Class Record spreadsheet. The System takes that file
in, translates it, and shows it. The analytics then say who is at risk of
failing, in what, and why.

### Importing the e-Class Record

The page is Class Record → **Import e-Class Record**
(`/grades/entry/import`); the teacher of the class or admin can use it.

**Parser:** `services/eclassRecordParser.js` reads DepEd's official
**SY 2026–27 SHS ECR** workbook, whose layout was read cell by cell from
DepEd's own file:
- `INPUT DATA` holds LRN and name: males in N/O and females in R/S, from
  row 11.
- Each `Term 1–3` sheet has the highest possible scores in row 14:
  - WW 1–10 in D–M, PT 1–10 in Q–Z;
  - ST1/ST2/TE in AD/AE/AF;
  - the workbook's own Initial Grade in AL and Term Grade in AM;
  - male learners in rows 17–66 and female learners in rows 68–117.

It reads cached values only.

**The plan:** `services/eclassRecordImport.js` builds the plan:
- learners are matched to the section **by LRN**, falling back to "Last,
  First";
- a term that already has items needs **replace or skip**;
- a term with finalized grades is **locked**;
- the **cross-check** puts the System's DO 015 grade beside the workbook's
  AM.

The plan is rebuilt on the server at commit. Importing **never submits
grades**: the teacher still reviews the record and clicks Submit.

**Template:** "Download template" on the import page
(`GET /api/class-record/import/template`) gives a blank ECR for the class
with its roster's LRNs and names already in INPUT DATA, so a filled copy
matches every learner on import.

**The template looks and computes like DepEd's own (2026-11-13).** The first
version wrote bare values into the right cells, and the group rightly asked
whether it was the real template. It now copies the official workbook's
look, read from DepEd's file:
- the same column widths, merged component bands and colours (grey bands,
  light-blue item numbers, grey TOTAL/PS/WS columns, blue/gold MALE/FEMALE
  numbers, a dark LEARNERS' NAMES bar);
- frozen headers and no gridlines;
- the school's name (`SCHOOL` in `services/analyticsReport.js`), the class's
  teacher and the school year.

It also **computes live in Excel** with the class's own DO 015 weight group:
- Total, PS and WS per component, the exam parts, the Initial Grade, and
  the Term Grade from a hidden HELPER transmutation table.
- The same steps and rounding as `services/gradeCalculator.js`, and a blank
  is not a zero.
- A Term Grade below 75 is shaded red, a score above its HPS is refused, and
  FINAL GRADES summarises the terms.

It is Excel 2013-safe on purpose (VLOOKUP, not XLOOKUP), because that is the
school's Excel. The import still reads only HPS, scores and the cached Term
Grade, in the same cells, so nothing about importing changed.

**Verified:**
- in Excel 2013 itself: 12 of 12 Term Grades equal the System's, DepEd's
  Table 5 example gives 88, and an Excel-saved copy imports with the
  cross-check agreeing;
- with a formula engine across all seven weight groups;
- `scripts/testEclassTemplate.js` (31 checks, part of `npm test`) guards the
  structure. Builder: `scripts/lib/eclassWorkbook.js`.

**Samples:**
- `npm run sample:eclass-record` writes a filled sample, from demo data, to
  `samples/`.
- `scripts/lib/eclassWorkbook.js` builds ECR-shaped workbooks for the
  tests.

### One "Import Data" page (2026-11-13)

Every spreadsheet import lives on **`/import`** (`pages/ImportHubPage.jsx`),
reached from one sidebar link, "Import Data". It replaces two identical
"Bulk Import" links. The e-Class Record import had been only a button on the
Class Record page, where the group couldn't find it.

**Three cards**, each shown only to whoever may use it
(`utils/permissions.js`):
- **e-Class Record** (class scores);
- **Student records**;
- **Attendance (SF2).**

**The SF2 import stays on purpose:** DepEd's e-Class Record holds **no
attendance**, only WW/PT/ST/TE. The daily register is what feeds the risk
score's attendance rate and the 12-absence alert.

### The learner's full record

A **Class Record tab** on the student page, and a **"Your Scores"** section
on the learner's own My Grades (`components/StudentClassRecord.jsx`,
`GET /api/students/:id/class-record`, scoped like the learner's grades).
- For every term and subject it shows every score out of its highest
  possible score, PS per component, the Initial Grade, the Term Grade and
  the status.
- A computed grade not yet submitted is labeled **provisional**.

### Analytics → Learner Outlook (first tab)

The service is `services/outlookCalculator.js`, with thresholds in
`config/outlookConfig.js`, served at `GET /api/analytics/learner-outlook`.
Each view comes from the signed DO 015:
- **Promotion outlook (¶67):**
  - on track (no subject below 75);
  - summer remedial (1–2 below 75);
  - retention risk (3 or more below 75).

  It uses each subject's average of finalized term grades so far.
- **Subjects causing failure:** learners below 75 per class, worst first.
- **Where learners lose points (¶68):** the WW / PT / EX average per class
  from the class record.
- **Early warning (¶68):** *provisional* term grades below 75, and missing
  scores, computed from the class record before anything is final. These
  never touch the official risk score, which still reads finalized grades
  only.
- **Absence alert (¶70):** 12 or more absences this school year, from the
  SF2 register counting absent and excused, with "approaching" from 9.
  ¶70's figure is "approximately twelve (12) absences". A "20% =
  failing" rule appeared only in a secondary summary and is **not** used.

**Advisers now open Analytics, scoped to the sections they advise**
(`middleware/analyticsScope.js` sets `sectionIds`, and
`analyticsCalculator.filterRows` applies it to every tab and export).
Admin, principal and guidance counselor still see the whole school. The
sidebar link is earned by advising a section.

**Tests:**
- `testOutlookCalculator.js` (19 checks);
- `eclassRecordImport.test.js` and `learnerOutlook.test.js`.

### Analytics for one learner: Learner Insights

The same views, applied to a single learner, live on the **learner's
record**: a "Learner Insights" tab, and "How You're Doing" on the learner's
own home. They are served by `GET /api/students/:id/insights` with
`components/LearnerInsights.jsx`. They show:
- the promotion outlook as a sentence;
- subject standing with the term-by-term trend;
- the strongest and weakest components;
- this term's provisional grades and missing scores;
- absences against 12.

**Why it lives on the record, not as a filter on Analytics:** Analytics is a
rollup across learners, while the record is already scoped correctly
(`loadScopedStudent`). So nobody sees insights for a learner they couldn't
already open.

**No new formulas:** it reuses `outlookCalculator`.

**Provisional means not finalized:** a grade already finalized this term
is excluded from every early-warning list, on the record and on Analytics,
because it is official.

## Subjects Per Term, Grades Per Term

**Corrected by the school on 2026-11-04.** Their words:

> "sa grade 11 ngayon new curriculum buong term 1 to 3 same subj lang. sa
> grade 12 nag iiba iba kada term ung subject maliban sa mga specialized —
> na dyan sa Babbage ung Computer System Servicing buong term 1-3 un."

So: **the school year is three TERMS, and there are no semesters.** A Grade
11 subject runs all three terms. A Grade 12 subject changes **every term**.
A specialized subject runs all three in both grade levels (their example:
Computer Systems Servicing).

**What the earlier version got wrong, because it is worth being able to
explain.** The client had said a Grade 12 subject changes each "term", and
"term" was read as "semester". That one word produced a whole layer:
`grading_periods.semester` stored which of two semesters each period
belonged to, `class_offerings.term` offered `sem1`/`sem2`, and a paragraph
here explained that the column could not be derived because *three quarters
do not divide evenly into two semesters*. All of that was bridging a
mistake. With an offering naming its term directly there is nothing to map,
the column is gone, and the model is smaller than it was. A clarified
requirement that *simplifies* the schema is a good thing to be able to show
a panel.

Two stored columns carry the policy now, and the rule that reads them lives
in one place: `backend/config/academicTerms.js`, mirrored for display in
`frontend/src/utils/academicTerms.js` **with identical parameter names** —
the two used to disagree (`subjectCategory`/`periodSemester` against
`category`/`semester`), so handing either one the other's object returned
`true` for everything, in the function that decides whether a learner's
grade is shown.

- **`subjects.category`** — `core | applied | specialized`, DepEd's own
  grouping, set on the Subjects form. Defaults to `core`. A specialized
  subject runs all year whatever its offering says.
- **`class_offerings.term`** — `full_year | term1 | term2 | term3`, NOT NULL
  DEFAULT `full_year`, and the UNIQUE includes it, because the same subject
  legitimately IS offered to one section more than once in a year — once per
  term. An enum rather than a nullable reference to a grading period on
  purpose: Postgres treats NULLs as distinct in a UNIQUE, so a nullable
  column meaning "whole year" would silently permit two whole-year rows for
  the same subject and section.

A term is matched to a period by **`sequence_number`** — `term2` means the
period numbered 2. Not by name, which is free text the school sets, and not
by id, which differs per school year.

**One fail-open rule, down from two.** A `full_year` class covers every
term, which is what every offering recorded before any of this existed
means. The second rule — "a quarter with no semester assigned yet is treated
as covered" — is gone, because there is nothing left to leave unset.

**The vocabulary is sized to three terms**, and that is a real limit rather
than an oversight: a school year with four periods would have one that no
single-term offering can name. `CLASS_TERMS` and `TERM_SEQUENCE` are the two
places to change, and `subjectTerms.test.js` asserts the limit so it is
discovered by a test rather than by a school.

**Migrating off semesters widened rather than narrowed.** A `sem1` offering
covered two periods and a single term cannot express that; splitting the row
would orphan every grade pointing at its `class_offering_id`. So every
term-bound offering became `full_year` and the admin re-narrows the Grade 12
classes on the Class Offerings page. Nothing recorded can disappear from a
learner's grade view because of a migration. The down migration restores the
shape but not the semester *values* — three rows per school year, re-entered
through the Academic Setup form.

**Grade viewing is one table per term** (`StudentGradesPage`), listing only
the subjects actually running in it, with a "Whole year" tab keeping the
report-card grid. It opens on the current term. A single wide table showed a
Grade 12 learner every subject they take at any point in the year with dashes
where one was not running — and a dash meaning "not taught this term" looked
exactly like one meaning "no mark recorded yet".

**2026-11-11: one table per term, stacked, in BOTH grade views.** The tabs
above became stacked tables (Term 1 → Term 3, all visible at once), and the
staff Grades tab on a student's record (`GradeHistory`), which still printed
every grade in one list with the terms interleaved, now uses the same
component — `components/TermGradeTables.jsx`, fed by
`utils/gradeMatrix.buildGradeMatrix` (cells keyed on `grading_period_id`).
The staff view adds a Status column for the approval chain; the student view
keeps the "Whole year at a glance" grid underneath. `GET /students/:id/grades`
now also returns `passingGrade` and `currentPeriodId` (school timezone). The
attendance calendar was shrunk at the same time — capped at 22rem with fixed
2rem cells, the days missed or late listed beside it (`.attendance-split`).

**The printed report card had the same flaw, and paper has no tabs.** It now
prints `n/a` for a term a subject was not taught in and a dash for one taught
with no final mark, with a one-line legend — and only where the data
supports the claim. The distinction comes from the section's own class
offerings; for a past school year, or a learner with no section, nothing is
claimed and every blank stays a dash. On a document handed to a parent, a
dash that might mean either is better than an "n/a" that might be a lie.

**Renaming is not a migration.** `grading_periods.name` is the school's own
label, so `npm run rename:terms` (`scripts/renameQuartersToTerms.js`) changes
Q1/Q2/Q3 to Term 1/2/3 on a deployment and leaves any other name alone. A
migration that rewrote it would overwrite whatever the school had chosen,
every deploy, with no way to say no.

**Three bugs fixed alongside the original per-term work**, all pre-existing:

- `gradeModel.getHistoryForStudent` had **no school-year filter** while every
  other per-period reader did. `sequence_number` is unique only within a
  year, so a learner's Grade 11 "Term 1" and Grade 12 "Term 1" landed in the
  same cell and the later row silently won.
- Subjects were matched **by name** in `myProgressController`,
  `StudentGradesPage` and the report card's pivot, justified by a comment
  claiming subject names are unique. Only `code` is — a Grade 11 and a Grade
  12 "Practical Research" merged into one row. All three now key on
  `subject_id`.
- `GradeHistory.jsx` still keyed its status colours on `draft`, a status
  removed when the approval chain was introduced, so three of the four
  statuses rendered unstyled.

## Dates and the School's Timezone
Every "which grading period are we in" decision uses the school's local date, not the server's UTC date — `backend/utils/schoolDate.js`, configurable via `SCHOOL_TIMEZONE`, defaulting to `Asia/Manila`. The school is at UTC+8, so a UTC date names *yesterday* for the whole morning, and on the first or last day of a term that resolves to the wrong grading period.

Related: a date is matched to a grading period **within one school year**, never across all of them (`gradingPeriodModel.findByDateInSchoolYear`). `grading_periods.sequence_number` is unique only within a year, so every per-period series — the risk trend, the report card, My Progress — is scoped by school year too. Without that, a learner's second year in the school mixes with their first.

## Data Privacy
- School has an existing Data Privacy Officer — coordinate on data handling practices for minors' academic records
- Keep data access scoped per role as described above

## Development Notes
- Build order: **Auth → Student Records → Attendance → Grades → Academic Progress Tracking → Intervention Tracking** (Enrollment was removed from scope — see above)
- The risk dashboard depends on grades/attendance data existing — don't build it first
- Keep the risk formula weights/thresholds in a single config file, not hardcoded throughout — the client or adviser may want to adjust them later
- No Google Classroom integration — out of scope, mentioned only as future work in the thesis

## Brand Colors (based on DepEd Progressive SHS - Bacoor City's official logo)
Use these for UI chrome — navbar, headers, buttons, login page, general branding:
- Primary (navy blue): `#1A3A6B` — main brand color, nav bar, primary buttons, headers
- Accent (golden yellow): `#F7C600` — highlights, active states, secondary accents, logo display
- Border/text (black): `#000000` — borders, strong text
- Background: `#F5F5F5` or white — keep clean, not literal gray
- Red accent (sunburst red): `#C8102E` — use sparingly, decorative only

**Important exception:** do NOT use the brand yellow/red for Academic Progress Tracking's bands. They have their own palette, kept visually distinct from brand colors — defined once as design tokens in `frontend/src/index.css` and never written as literals anywhere else.

**Revised 2026-10-28 — this section previously mandated a traffic-light scheme (green / amber / red). The shipped design deliberately replaced it, and the spec has been updated to match rather than the other way round.** The reasoning, in case a panel asks:

- **Risk level is ordinal, not categorical.** Low → Medium → High is one thing getting worse, not three unrelated states. Traffic-light colors say "stop / caution / go", which are *different* categories, so the ramp read as three separate meanings rather than one scale.
- **It inverted the meaning at a glance.** Under traffic-light, a student flagged "At Risk — Low" got a **green** badge while "Performing Well" got gold. Someone scanning a roster for colour saw green on a flagged learner and gold on a thriving one.
- **The replacement is one hue deepening with severity**, so severity reads as intensity: `--band-at-risk-low` `#f0917f` → `--band-at-risk-medium` `#cc4125` → `--band-at-risk-high` `#8c1d1d`. The other two bands sit outside that ramp entirely: `--band-average` `#2a78d6` (blue) and `--band-performing-well` `#2fb344` (green).
- **Checked for colour-vision deficiency**, not assumed: the ramp was validated for deuteranopia separation, which a green/amber/red scheme fails badly — red–green is the single most common form.

Band colours are never the only signal: every band also carries its label as text (see the System-Wide UI Standards section on status badges).

## Account Creation Flow (confirmed)
Registration stays admin-only (no public self-signup) — but here's how each role actually gets an account:

**Staff (adviser, subject teacher, guidance counselor, registrar, principal):**
- Admin/registrar creates the account via a form (name, email, role)
- System generates a temporary password
- Admin shares credentials with the staff member directly (no school email system exists)
- Force a password change on first login

**Students:**
- No school-issued email exists — students use personal email, collected directly when the registrar adds their record to Student Records (enrollment now happens on paper, not through the portal — see REMOVED: Enrollment Management above)
- Registrar/admin manually creates the student's portal account after adding their Student Record, using the same account-creation form/flow as staff
- Temporary password generated, forced password change on first login
- No self-registration flow for students — avoids reopening the open-registration security risk already ruled out in the Auth module

## User Management (expanded from "Staff Accounts" as of 2026-10-16)
The old Staff-only account list is now a full **User Management** module (Admin + Registrar access, same as before) covering every role, staff and students alike:
- **List/search/filter** all accounts by role, active/inactive status, and section/class assignment
- **Edit account details** — name, email, and role (role reassignment is blocked while the account still actively advises a section or teaches a class offering — reassign those in Academic Setup first, so `sections.adviser_id` / `class_offerings.teacher_id` never point at a user whose role no longer matches)
- **Activate/Deactivate** instead of hard-delete — ties into the existing `is_active` check in `authMiddleware.js`, already re-verified on every request, so access is lost immediately. Historical records (grades submitted, interventions logged) stay intact. An admin cannot deactivate their own account (self-lockout guard)
- **Bulk account creation for students** — reuses the same per-student eligibility/creation logic as the single "New Account" form (`backend/services/accountCreation.js`), either from a "Pending Student Accounts" list (any existing Student Record with no login yet) or directly from the Bulk Import result screen for freshly-imported students
- Role reassignment *into or out of* `admin` is blocked outright — admin was never a role handed out through a web form (see `CREATABLE_ROLES` in `backend/config/auth.js`) and that holds for edits too

**Dependency fix, actually completed this time:** the student account **auto-provisioning trigger referenced above (REMOVED: Enrollment Management) was still wired into `studentController.js` until 2026-10-16** — every student record saved with an email and `enrollment_status: 'enrolled'` (the default since 2026-10-08) silently created a portal account, contradicting this doc. It's now genuinely removed; account creation for a student is always a deliberate, separate action (single or bulk, both described above).

## Forgot Password / Reset Flow
- "Forgot Password" link on login page → user enters email → system sends a time-limited reset link (expires in ~1 hour) via email
- Requires a `password_reset_tokens` table (token, user_id, expires_at, used). Only the token's **hash** is stored
- **Fallback for demo/defense reliability:** admin/registrar can also manually trigger a password reset for any user (generates a new temp password, forces change on next login) — don't depend solely on live email delivery during the defense demo

**Email service: SMTP, not Resend.** This section specified Resend, and the
code shipped with it, but SMTP is now the preferred transport and Resend is
the fallback — a deliberate reversal, recorded here rather than left to
contradict `backend/services/emailService.js`. The reason: Resend's free
sending identity `onboarding@resend.dev` delivers **only to the address that
owns the Resend account**, and every other recipient is refused with a 403.
On this system the people who most need a reset link are *students, at their
own personal addresses*, so the free tier cannot reach the users the feature
exists for. Sending to arbitrary recipients through Resend needs a verified
domain, which the school does not have. When both are configured, SMTP wins.

**"Configured" is not "working", and the difference used to be invisible.**
`canSendEmail()` checks that `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are
non-empty — which a wrong App Password satisfies. The flow then switches
itself on, the user is told "if an account exists, a link has been sent"
(said deliberately, so the endpoint cannot be used to discover which
addresses have accounts), and the send fails into a deploy log. **`npm run
check:email`** closes that gap: it opens a real connection, authenticates,
and names the failure (`EAUTH` = wrong App Password or 2-Step Verification
off; `ETIMEDOUT` = usually the port; `EDNS` = a typo in the host). With an
address it sends a real test message through the same code path production
uses. It never prints the password. Run it against the deployment with
`railway run npm run check:email`.

**`FRONTEND_URL` is the silent one.** `passwordReset.js` defaults it to
`http://localhost:5173`, so without it the email sends perfectly and the link
is dead on arrival. The server warns about this at boot on a production
deployment, and names its email transport in the same line.

**2026-11-03 — self-service reset by email was built, tested, configured,
and then found to be blocked by the hosting platform itself.** SMTP
credentials were set on Railway and attempted a real send; the result was
`Error: Connection timeout` — a very specific failure shape, confirmed by
reading nodemailer's own source (`smtp-connection/index.js`): no response at
all to the TCP connection, which only fires after nodemailer's own 2-minute
clock runs out. A wrong credential fails fast (`EAUTH`) and did not happen
here. Cross-checked against Railway's own support forum (several
staff-corroborated threads, including one titled exactly *"Connection
Timeout with smtp.gmail.com on Port 465"*): **Railway's Hobby, Free and
Trial plans block outbound SMTP entirely** — only Pro and above allow it.
This is a platform restriction, not a bug in this codebase, and not
something `SMTP_PASS` being right or wrong changes.

**The decision, given no budget for Railway Pro and no domain to verify with
Resend** (the free tier's shared sender can only reach the Resend account's
own owner, as above — useless for reaching students at arbitrary addresses):
ship what already works. **The admin/registrar manual reset — already built,
already tested — is therefore the supported recovery path on this
deployment, not a backup for one.** The SMTP variables have been removed
from Railway again, which restores the honest "Password reset by email is
not set up for this school" message instead of a 502 that reads as
transient and invites retrying something that can never succeed. If this is
revisited later, the two realistic paths are a verified domain with Resend
(free, already wired into `emailService.js`, HTTPS rather than SMTP so it
sidesteps the block entirely) or a single-sender HTTPS API such as SendGrid
or Brevo (no domain needed, verifies one existing address by email
confirmation, but needs a new transport added to `emailService.js` — not
built today). `npm run check:email` now recognizes this exact failure by
name (`CONNECT_TIMEOUT`) and says so, rather than printing a bare error, so
it is immediately recognizable if it comes up again.

## Announcements (client-requested, added post-Phase-1 — REMOVED 2026-11-11, kept here as history)
- A home page / announcement banner feature, requested directly by the client
- Posting access: **admin, registrar, guidance counselor, or ICT faculty** (not advisers/subject teachers/students)
- Visible to all logged-in users on login/home page
- Each announcement: title, body text, optional file attachment, posted-by, posted date
- Not real-time — standard page load/refresh is fine, no WebSockets needed
- Scope note: this is a separate feature from Chat (also client-requested, but not yet scoped — do not build chat until roles/real-time requirements are confirmed)

## System-Wide UI Standards (applies to every page, not just one module)
Based on a reference college portal design the team liked — apply these patterns consistently app-wide:
1. **Stat card rows** at the top of list/dashboard pages — icon + number + label summarizing the page's data (e.g. Academic Progress Tracking: At Risk/Average-Steady/Performing Well counts; Interventions: open/monitoring/resolved/escalated counts)

   **Every stat card explains itself.** A card is a disclosure button: clicking
   it opens a panel underneath the row saying what the number actually counts,
   what is deliberately excluded, a breakdown where the page already has the
   data, and a link to the list it summarises. This is not decoration — these
   figures are quietly ambiguous in ways that change decisions. "At-risk
   students" on the Dashboard excludes Low risk while the same words on
   Analytics include it; "Flagged on this page" counts only the rows currently
   rendered; a resolution rate's denominator is closed cases, not all of them.
   Each of those is a wrong conclusion waiting to be drawn from a correct
   number, and the panel is where the number stops being a claim the reader
   has to take on trust.

   `hooks/useStatExplainer.js` owns the open/closed state and the
   `onClick` / `aria-expanded` / `aria-controls` wiring — spread
   `cardProps(key)` onto a card and it is a correct disclosure control.
   `components/StatDetail.jsx` renders the content declaratively, inside the
   same `ExplainerPanel` the student pages use, so one idea of "an
   explanation" serves the whole app. A page with more than one stat row
   passes a second argument naming that row's panel, so the explanation opens
   under the row that was clicked.

   **The content rule: a breakdown must come from data the page already
   fetched, never a second request.** An explanation that re-asks the server
   can disagree with the figure it sits under, which is worse than no
   explanation — and reusing the page's own data keeps per-role scoping
   correct for free, since that data was already fetched under this user's
   permissions.

   The student-facing figures explain themselves differently and should stay
   that way: `components/StatExplainer.jsx` shows the actual **arithmetic**
   (the marks, the division, the result), because those numbers are a
   calculation the student is entitled to check. Staff-facing counts are
   filtered lists, where the arithmetic is trivial and the definition is the
   whole question.
2. **Breadcrumb navigation** at the top of every page (Home / Section / Subpage)

   **Every role reaches its own profile from the sidebar.** The footer's
   identity block (name + role, above Log out) is itself the link to
   `/profile` — the thing showing who you are is the thing that opens your
   page. No role gate: everyone owns their profile, and the page already
   adapts (a student has no assignments panel). It carries its own icon as
   well as the text, because the collapsed icon rail hides labels: without
   one it would disappear from the sidebar entirely at that width and the
   top-bar account menu would become the only route to it.

   **Pickers open on the answer, not on "-- select --".** A section picker
   opens on the user's own section (`utils/defaultSelection.js`) and a
   grading-period picker on the period the school is currently in
   (`hooks/useGradingPeriods.js`). Finalize Grades was the clearest case: an
   adviser with 22 principal-verified grades waiting arrived at a page that
   said "pick a section and grading period" with the work one click away.
   Verify Grades had solved it alone by fetching the full list and matching
   on period NAME — fragile, because `grading_periods.name` repeats across
   school years while only the id is unique. `GET /grading-periods/current`
   now returns the id, so all three grade pages resolve it in one request
   and none of them guesses.
3. **Status badges** — all status values (enrollment status, risk level, intervention status, document review status) render as colored pill badges, not plain text. Risk levels keep their own green/amber/red; other statuses use visually distinct colors so they're never confused with risk indicators
4. **Consistent card/panel containers** for content blocks — avoid bare unstyled tables

   **Create/edit forms open as a modal, not inline above the table.** Every
   list page used to render its form between the heading and the table, so
   clicking Edit on a row near the bottom put the form off-screen — you
   scrolled up to find what you had just opened, and back down to see whether
   it worked. `components/Modal.jsx` is built on the **native `<dialog>`**
   with `showModal()`, which is not a stylistic preference: it gives focus
   trapping, Escape, a background made `inert` and a `::backdrop` for free,
   and the browser's **top layer** escapes the three things that make this app
   hostile to floating elements — `.app-shell__content` is `overflow-x: clip`
   AND the scroll container, `.table-card` has its own overflow, and
   `.app-shell__page` creates a stacking context. `RowMenu.jsx` records what
   those do to an ordinary positioned element ("the menu opened, the items
   rendered, and nothing appeared"). The top layer also means no z-index has
   to be chosen against the existing ones (RowMenu's sheet 60, drawer scrim
   40, top bar 15).

   Two details that are easy to get wrong here: the scroll lock must target
   `.app-shell__content`, **not** `<body>`, because that is what actually
   scrolls; and a half-filled form confirms before discarding, reusing the
   wording already in `utils/unsavedChangesGuard.js` rather than inventing a
   second version of the same prompt. The modal detects its own dirtiness by
   listening for `input`/`change`, so no page has to track and pass a flag.

   **A form that is already beside what it edits stays inline** — the
   intervention form inside an expanded Academic Progress row, and the
   Dashboard's announcement editor, which replaces the announcement being
   edited. Those never had the problem; moving them into a dialog would lose
   the context that makes them clear.
5. **Pagination** on any list view with more than ~15 rows
6. **One consistent icon library** used throughout (sidebar nav, stat cards, action buttons) — no mixing icon styles
7. **Every write reports itself — as a toast, not a page-top Alert.** A
   successful save raises a short-lived toast naming what was saved
   (`context/ToastContext.jsx`, rendered by `components/Toast.jsx`), because
   the confirmation had the same flaw the edit forms did: act on a row at the
   bottom of a fifteen-row table and the receipt appeared at the top of the
   page, where nobody was looking.

   **Failures deliberately do NOT move.** `Alert.jsx` says it is "deliberately
   NOT a toast", and for what it describes that is right — a message
   explaining why the page in front of you is wrong has to stay until the
   state changes. That reasoning had simply been applied to a second,
   different job. The split is by job, not severity: a *receipt for something
   you did* is a toast; the *state of what you are reading* is an inline
   Alert. Nothing that needs acting on is ever only in a toast. The toast
   stack is portalled to `<body>` for the same clipping reason the modal uses
   the top layer, and `hooks/useWriteFeedback.js` raises it for every page at
   once, so no page wires this up individually.
   Before this, a failure showed a message and a success showed nothing, so
   **silence meant success** — the opposite of what people expect, and it left
   a deactivation (the one irreversible-looking action on the setup pages)
   entirely unconfirmed. `hooks/useWriteFeedback.js` owns the error, the
   confirmation and the in-flight guard together so the three cannot drift
   apart per page.
8. **No write can be fired twice.** The same hook keys its busy flag on the
   row or form being acted on, so only that control is disabled rather than
   the whole table. The gate is a ref, not state: a double-click runs both
   handlers before React re-renders, so a state flag would still read as idle
   in both.
9. **Field errors are attached to the field.** `components/FormField.jsx`
   renders the message under the input and clones the control to carry
   `aria-invalid` and `aria-describedby`. Wiring those by hand per input is
   the kind of thing that gets done on the first form and forgotten on the
   rest — the app had zero of either before this. A page-top summary is for
   what the server said about the request as a whole, not for which of eleven
   inputs is wrong.
10. **A disabled control says why.** A greyed-out submit with no explanation
    is a dead end; the reason goes next to it, in an `aria-live` region so a
    screen reader hears it change.
11. **Loading states draw the shape that is coming** (`components/Skeleton.jsx`).
    "Loading…" as a bare word is reserved for the one case where the shape is
    genuinely unknown — app boot, before the router has chosen a page.
12. **Anything that cannot be quietly undone asks first** —
    `hooks/useConfirm.jsx`, the app's own dialog on `Modal`, never
    `window.confirm`. Resetting a password, deactivating an account and
    deactivating a section, subject or class offering each name the object and
    the consequence before acting; Cancel, Escape and the backdrop all answer
    "no". Reactivating stays one click. The consequence text states only what
    the system really does — deactivating a section with recorded history is
    refused by the server, so the dialog does not promise that records "stay".

    **Extended system-wide on 2026-11-12, at the group's request.** Every
    *important* action now confirms, naming the object and the consequence,
    with a short summary in the dialog's `details` slot (counts, class and
    term, the note being sent):
    - Log out (folds the unsaved-changes warning into the same dialog).
    - The whole grade chain: submit (class, term, who is still without a
      grade), verify one or a selection, reject (quotes the remark back),
      and finalize (official record, no resubmission, risk recalculated).
    - Saving daily attendance (section, date, counts; says when it replaces
      a recorded day).
    - Both bulk-import commits, and bulk student-account creation.
    - Logging an intervention, and changing an intervention's status. The
      status check lives in the shared `InterventionDetailPanel`, so both
      entry points get it.
    - Setting the current school year.
    - Editing an account **only when its role or email changes**.

    **Ordinary form saves deliberately do not confirm** — creating or
    editing a student, subject, section, class offering, school year or
    grading period, or an account's name. Filling a form and pressing Save is
    already deliberate; asking twice on every save trains people to click
    through the dialogs that matter. That boundary was the group's choice.
13. **One content width.** The page column is capped at `--page-max-width`
    (1360px) through `--page-gutter` in `Layout.css`, which the top bar
    shares so the breadcrumbs line up with the title. Without it, list pages
    on a 1920px monitor used a third to half of the column.
14. **A list page's table fills that column** (`.table-card--fill`, applied by
    DataTable when a column is `primary`), sharing the slack across columns.
    Tables without an identity column (import review, registers) still size to
    their content, which is where columns-pushed-apart was the real problem.
15. **Search, filters and the create button sit in `TableToolbar`** on every
    list page, Academic Setup included.
16. **Shared utilities, not inline styles** — `.button-row`, `.text-muted`,
    `.help-text`, `.mt-*`/`.mb-*` at the end of `index.css`. An inline style
    is for a data-driven value only (a computed width, a series colour).

17. **Every action answers, and a failure never looks like "nothing here"
    (2026-11-12).** Finalize Grades rendered a blank area when an admin picked
    a section with nothing to finalize — the table, empty state and skeleton
    all sat inside a `rows.length > 0` block. An audit found ~30 more
    variants, now fixed system-wide by four rules:
    - **A list that refetches dims and says "Updating…"** — built into
      `DataTable` (`refreshing`), so every list page got it at once.
    - **A failed load clears what was on screen.** Enter Grades and Daily
      Attendance used to keep the previous sheet editable under the new
      class/section, so a save would have written it against the wrong one.
    - **A picker's own request reports its failure** (an inline Alert), and
      no `.catch(() => [])` is allowed to turn an outage into an empty list
      that claims something ("no subjects", "you advise nothing").
      `useGradingPeriods` returns `error` for the same reason.
    - **Every write gets a receipt and a busy state**, and an empty list says
      why it is empty where the data can tell: Finalize Grades reports where
      the section's other grades are in the approval chain
      (`GET /grades/pending` → `pipeline`).

**Measured, not assumed (2026-11-10).** A Playwright + axe-core sweep of every
page for every role at 1440/390/320 found 0 console errors and 0 failed
requests but 6 kinds of WCAG violation (aria-expanded on table rows, aria-sort
on the button instead of the header, unlabelled grade inputs, an unnamed
meter, focusable bars inside a `role="img"` chart, no `main` on the sign-in
pages) and 7 pages silently clipped at phone width. All are fixed and the
sweep now comes back empty; a keyboard pass of 528 focus stops finds a visible
focus indicator on every one.

Apply the navy/gold brand palette (see Brand Colors section above) throughout. Build page by page, verifying each before moving to the next.

## Responsive Design (phone and desktop)

The portal is used on phones, so every page is built to work at **320px**
upward. Three things carry that, and they are worth knowing before changing
any layout.

**Breakpoints — three, written as literals.** `560px` (a table becomes one
card per row), `720px` (the phone boundary: navigation drawer, page gutters,
compact charts) and `1024px` (above the phone, the sidebar is an icon rail;
below 721px it is a drawer; at 1024px and up it is the full 216px panel).
CSS custom properties are **not valid inside an `@media` condition**, so
these numbers genuinely have to be repeated in each stylesheet rather than
shared as a token. The 720 is mirrored in JS as `PHONE_QUERY` in
`frontend/src/hooks/useMediaQuery.js`, which is the single place the JS side
names it.

**Navigation below 720px is a drawer, not a rail.** The sidebar leaves the
layout entirely (`position: fixed`, `transform: translateX(-100%)`) and opens
over the page from the top bar's menu button, with a backdrop, full text
labels, focus trapped inside and the page marked `inert`. Before this it
stayed in the layout as a 56px strip of unlabelled icons, which cost 14% of
a 390px screen and told the reader nothing.

**Charts size themselves from their own measured width, not the viewport**
(`frontend/src/components/charts/chartLayout.js`). This is the important one:
a chart is narrow because its *card* is narrow, and a small-multiple panel on
a 1440px monitor is narrower than the same chart on a phone — measured at
241px against 266px before this was fixed. A viewport media query cannot see
that; the `ResizeObserver` width in `hooks/useChartWidth.js` can. Padding and
height come from that width, while the viewBox stays pinned 1:1 to real
pixels so label sizes never scale.

**`.app-shell__content` is `overflow-x: clip`.** Anything wider than the
content column is cut off *silently* — there is no scrollbar anywhere to
recover it, because the app scrolls inside that element rather than in the
window. So a grid that could overflow must either reflow (preferred) or own
its own `overflow-x: auto`, the way `.table-card` and `.tabs` do. When
changing a layout, check it at 320px: the damage is invisible otherwise.

**Touch targets** are handled by `@media (pointer: coarse)` in `index.css`,
which raises controls to the 44px floor. Add to that block rather than
starting a parallel one.

## Code Quality Standards (important — this will be defended in front of a panel)
- **Comment generously.** Every function needs a short comment explaining what it does and why, not just what the code literally says. Comment non-obvious logic in detail (especially the risk-trend calculation and the risk-recalculation trigger) since this is what we'll need to explain/debug live during defense.
- **Keep files organized and single-purpose.** One concern per file (e.g. `riskCalculator.js` handles only risk scoring, `attendanceController.js` handles only attendance routes). No giant catch-all files.
- **Use clear, descriptive naming.** Variables, functions, and files should be self-explanatory (`calculateRiskScore()`, not `calc()` or `doStuff()`). A panelist should be able to read a function name and guess what it does.
- **Avoid unnecessary complexity/cleverness.** Prefer simple, readable code over "clever" one-liners — this needs to be explainable under pressure, not just functional.
- **Consistent structure across modules.** Each module (records, attendance, enrollment, risk) should follow the same folder/file pattern (e.g. `routes/`, `controllers/`, `models/`) so the codebase is predictable and easy to navigate.
- **Separate config from logic.** Thresholds, formulas, and constants (risk weights, grade/attendance thresholds) live in a dedicated config file — never hardcoded inline — so they're easy to point to and explain.
- **Add README notes per module** (or at minimum in CLAUDE.md) briefly explaining what each module does and how it connects to the others, for quick orientation before a defense/debugging session.
- When asking Claude Code to build something, explicitly include "add clear comments" and "keep this readable/well-structured" in the prompt if it's a complex feature (like the risk formula) — don't assume it by default.
