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
2. **Attendance Tracking** — two levels, both manually input (no QR/RFID/biometric scanning):
   - **Daily/homeroom attendance** — logged by the adviser (the official DepEd SF2 record); this is the authoritative record used for the risk formula's attendance rate
   - **Subject-level attendance** — logged separately by each subject teacher, per subject/period; supplementary, not used in risk scoring
3. **Trend-Based Academic Risk & Intervention Tracking Dashboard** (the innovation — see below)

## REMOVED: Enrollment Management (as of 2026-10-08)
The client requested removing digital enrollment entirely — they want to keep their existing **paper/hard-copy** enrollment process (report card, birth certificate, SF10 submitted physically), not digitized through the portal.

**Remove from the system:**
- Enrollment document upload/review feature, Enrollment Queue page, enrollment-related stat cards on the Dashboard, the Enrollment sidebar section

**Important dependency to fix:** student portal accounts were previously **auto-created** when `enrollment_status` flipped to `enrolled` via the Enrollment module. That trigger no longer exists. Student accounts now follow the same path as staff accounts: **registrar/admin manually creates the student's account** (using the account-creation flow already built for staff) after the student's record is added to Student Records, once the student has enrolled on paper.

**For the thesis manuscript:** this is a legitimate, documentable scope reduction — frame it in Chapter 1/Methodology as: the system initially scoped digital enrollment management, but the client opted to retain their existing paper-based enrollment process, so scope was narrowed to records, attendance, grades, and risk/intervention monitoring. The system now assumes a student has already been enrolled on paper before their record is added to the portal.

## User Roles & Access
- **Admin** — manages accounts (registration is admin-only, no public self-signup)
- **Principal** — verifies/approves grades submitted by subject teachers (see Grade Approval Workflow below). One school-wide position, so they also *read* school-wide: Analytics, the Academic Progress Tracking dashboard, and student records. They hold no advisory section and teach no class, so the attendance and grade-entry pages are not shown to them. Logging interventions stays with advisers and guidance counselors — the principal approves grades and reads the rollup; the per-learner follow-up is not theirs.
- **Advisers** — see only students in their own advisory section; finalize grades into the official record (final step of the approval workflow)
- **Subject teachers** — submit initial grades and input attendance for the classes they actually teach (scoped by class/subject, not by advisory section — a teacher may teach students across multiple sections)
- **Guidance counselors** — view flagged/at-risk students, log interventions
- **Registrar staff** — manage student records; create student/staff portal accounts once a student has enrolled on paper (see REMOVED: Enrollment Management above)
- **ICT faculty** — post announcements. Added alongside the Announcements feature (see below) and has no other permissions: the school's ICT staff maintain the noticeboard, they do not mark attendance or handle records. Their navigation is Home and nothing else — the noticeboard lives there. (Until 2026-10-29 the sidebar also offered them the attendance, grade and student pages, because visibility was guessed from the role label; every one of them opened empty, since they advise no section, teach no class, and have no student read scope. The server always refused the writes; it was the navigation that lied.)
- **Students / Parents** — view own records only (no separate parent role yet — out of scope for Phase 1, students role covers this access level)

**Navigation is driven by assignment, not by role label.** Write access to
the attendance and grade pages is decided by `sections.adviser_id` and
`class_offerings.teacher_id`, so the role alone cannot say whether a page has
anything in it. `AuthContext` counts the signed-in user's own sections and
class offerings once per session and the sidebar hides any link whose count is
zero — so an adviser who teaches nothing is not offered Enter Grades, and a
subject teacher who advises nothing is not offered Finalize Grades. If those
counts fail to load the sidebar falls back to showing every role-eligible
link, which is only a cluttered menu: the server is the real boundary.

**Note on who can reset a password.** Only **admin** and **registrar** can create accounts or issue a temporary password (`CREATABLE_ROLES` in `backend/config/auth.js`, and `canWrite` in `backend/routes/userRoutes.js`). Advisers and ICT faculty cannot — the forgot-password fallback text says so, and must keep saying so, since with email unconfigured that is the only recovery route a user has.

**Admin accounts are special.** `admin` is never offered on any account-creation form and can never be assigned or removed by editing an account. Beyond that, an admin account may only be acted on by *that same admin* — no other role, and no second admin, can reset its password, change its email or deactivate it. Without that last rule a registrar could reset the admin's password, read it out of the response, and sign in as admin.

## Grade Approval Workflow (confirmed with client)
Grades are NOT entered directly by one person. They go through a 3-stage approval chain:
1. **Subject teacher** creates/submits a grade (initial entry — status: Submitted)
2. **Principal** reviews and verifies it (status: Principal-Verified) — the Principal is one person for the whole school, not a per-subject role
3. **Adviser** inputs the grade into the student's official record (status: Finalized — this is the "official" grade)

- **Rejection handling:** if the Principal rejects a submitted grade, it returns to the Subject Teacher to resubmit (status reverts to Submitted / or a Rejected status with a resubmit action)
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
When a student is flagged, the adviser/guidance counselor logs an intervention:
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
- **Report Card PDF** — a printable card per student, built from finalized grades and daily attendance, scoped to one school year. Adviser (own section), admin, registrar, or the student themselves.
- **My Progress** (student self-view) — a student's own grades, attendance, risk band and the plain-language version of any triggered factors, including what number they would have to reach to clear each one. Read-only and scoped to themselves; no school-wide figures reach it.
- **Learner Status fields** (`is_pwd`, `is_4ps`, `is_als_graduate`) — DepEd reporting fields on the student record. **Descriptive only: they never feed the risk formula.** Visibility is per field and per role (`backend/config/learnerStatus.js`): a subject teacher may see a disability flag because they teach the learner, but not 4Ps status, which is household financial information. Students never see any of the three about themselves. The same map gates writes, not just reads.

## Dates and the School's Timezone
Every "which grading period are we in" decision uses the school's local date, not the server's UTC date — `backend/utils/schoolDate.js`, configurable via `SCHOOL_TIMEZONE`, defaulting to `Asia/Manila`. The school is at UTC+8, so a UTC date names *yesterday* for the whole morning, and on the first or last day of a quarter that resolves to the wrong grading period.

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
- Email service: **Resend** (resend.com) — generous free tier (3,000 emails/month), simple Node.js API, easier to set up than SMTP for a capstone project
- Requires a `password_reset_tokens` table (token, user_id, expires_at, used)
- **Fallback for demo/defense reliability:** admin/registrar can also manually trigger a password reset for any user (generates a new temp password, forces change on next login) — don't depend solely on live email delivery during the defense demo

## Announcements (client-requested, added post-Phase-1)
- A home page / announcement banner feature, requested directly by the client
- Posting access: **admin, registrar, guidance counselor, or ICT faculty** (not advisers/subject teachers/students)
- Visible to all logged-in users on login/home page
- Each announcement: title, body text, optional file attachment, posted-by, posted date
- Not real-time — standard page load/refresh is fine, no WebSockets needed
- Scope note: this is a separate feature from Chat (also client-requested, but not yet scoped — do not build chat until roles/real-time requirements are confirmed)

## System-Wide UI Standards (applies to every page, not just one module)
Based on a reference college portal design the team liked — apply these patterns consistently app-wide:
1. **Stat card rows** at the top of list/dashboard pages — icon + number + label summarizing the page's data (e.g. Academic Progress Tracking: At Risk/Average-Steady/Performing Well counts; Interventions: open/monitoring/resolved/escalated counts)
2. **Breadcrumb navigation** at the top of every page (Home / Section / Subpage)
3. **Status badges** — all status values (enrollment status, risk level, intervention status, document review status) render as colored pill badges, not plain text. Risk levels keep their own green/amber/red; other statuses use visually distinct colors so they're never confused with risk indicators
4. **Consistent card/panel containers** for content blocks — avoid bare unstyled tables
5. **Pagination** on any list view with more than ~15 rows
6. **One consistent icon library** used throughout (sidebar nav, stat cards, action buttons) — no mixing icon styles
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
