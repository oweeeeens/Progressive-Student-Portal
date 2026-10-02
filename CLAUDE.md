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
3. **Enrollment Management** — digital document upload only:
   - Required docs: report card, birth certificate, **SF10** (not Form 137/138)
   - **No payment/fee collection or verification** — public school, no enrollment fees
4. **Trend-Based Academic Risk & Intervention Tracking Dashboard** (the innovation — see below)

## User Roles & Access
- **Admin** — manages accounts (registration is admin-only, no public self-signup)
- **Principal** — verifies/approves grades submitted by subject teachers (see Grade Approval Workflow below)
- **Advisers** — see only students in their own advisory section; finalize grades into the official record (final step of the approval workflow)
- **Subject teachers** — submit initial grades and input attendance for the classes they actually teach (scoped by class/subject, not by advisory section — a teacher may teach students across multiple sections)
- **Guidance counselors** — view flagged/at-risk students, log interventions
- **Registrar staff** — manage enrollment submissions and records
- **Students / Parents** — view own records only (no separate parent role yet — out of scope for Phase 1, students role covers this access level)

## Grade Approval Workflow (confirmed with client)
Grades are NOT entered directly by one person. They go through a 3-stage approval chain:
1. **Subject teacher** creates/submits a grade (initial entry — status: Submitted)
2. **Principal** reviews and verifies it (status: Principal-Verified) — the Principal is one person for the whole school, not a per-subject role
3. **Adviser** inputs the grade into the student's official record (status: Finalized — this is the "official" grade)

- **Rejection handling:** if the Principal rejects a submitted grade, it returns to the Subject Teacher to resubmit (status reverts to Submitted / or a Rejected status with a resubmit action)
- **Risk formula uses only Finalized grades** (post-adviser-input), not grades still in Submitted or Principal-Verified status. Note: this means risk detection may lag behind real-time classroom performance due to the approval pipeline — call this out explicitly as a known limitation in the thesis manuscript (Scope and Limitations chapter), framed as working within the school's existing grade-approval process rather than bypassing it.

## Risk Detection Logic (Part A)
Recalculated whenever new grades/attendance are entered (not real-time).

Per grading period (per term), track each student's:
- Average grade
- Attendance rate

**Trend (rate of change) formula:**
```
Trend = (Most Recent Value − Earliest Value) / Number of Periods
```

**Risk scoring formula:**
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

## Intervention Tracking Logic (Part B — the closed loop)
When a student is flagged, the adviser/guidance counselor logs an intervention:
- Fields: intervention type (Parent Conference / Tutoring Referral / Counseling Referral / Attendance Follow-up / Other), notes, date logged
- Status: **Open → Monitoring → Resolved / Escalated**
- On next grading period's risk recalculation, auto-compare new risk level to the risk level at time of intervention:
  - Improved → mark **Resolved**
  - Same/worse → mark **Escalated**

## Data Privacy
- School has an existing Data Privacy Officer — coordinate on data handling practices for minors' academic records
- Keep data access scoped per role as described above

## Development Notes
- Build order: **Auth → Student Records → Attendance → Enrollment → Risk Dashboard → Intervention Tracking**
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

**Important exception:** do NOT use the brand yellow/red for Risk Dashboard risk levels. Risk levels (Low/Medium/High) must use the standard traffic-light convention instead, kept visually distinct from brand colors:
- Low Risk: green (e.g. `#2E7D32`)
- Medium Risk: amber/orange (e.g. `#ED6C02`) — distinct from brand gold
- High Risk: red (e.g. `#D32F2F`) — distinct from brand red accent

## Account Creation Flow (confirmed)
Registration stays admin-only (no public self-signup) — but here's how each role actually gets an account:

**Staff (adviser, subject teacher, guidance counselor, registrar, principal):**
- Admin/registrar creates the account via a form (name, email, role)
- System generates a temporary password
- Admin shares credentials with the staff member directly (no school email system exists)
- Force a password change on first login

**Students:**
- No school-issued email exists — students use personal email (already captured during enrollment)
- Account is auto-created using the student's personal email at the moment `enrollment_status` flips to `enrolled` (ties into the existing auto-enrollment feature)
- Temporary password generated, forced password change on first login
- No separate self-registration flow for students — avoids reopening the open-registration security risk already ruled out in the Auth module

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
1. **Stat card rows** at the top of list/dashboard pages — icon + number + label summarizing the page's data (e.g. Enrollment Queue: pending/approved/rejected counts; Risk Dashboard: low/medium/high counts; Interventions: open/monitoring/resolved/escalated counts)
2. **Breadcrumb navigation** at the top of every page (Home / Section / Subpage)
3. **Status badges** — all status values (enrollment status, risk level, intervention status, document review status) render as colored pill badges, not plain text. Risk levels keep their own green/amber/red; other statuses use visually distinct colors so they're never confused with risk indicators
4. **Consistent card/panel containers** for content blocks — avoid bare unstyled tables
5. **Pagination** on any list view with more than ~15 rows
6. **One consistent icon library** used throughout (sidebar nav, stat cards, action buttons) — no mixing icon styles
Apply the navy/gold brand palette (see Brand Colors section above) throughout. Build page by page, verifying each before moving to the next.

## Code Quality Standards (important — this will be defended in front of a panel)
- **Comment generously.** Every function needs a short comment explaining what it does and why, not just what the code literally says. Comment non-obvious logic in detail (especially the risk-trend calculation and the risk-recalculation trigger) since this is what we'll need to explain/debug live during defense.
- **Keep files organized and single-purpose.** One concern per file (e.g. `riskCalculator.js` handles only risk scoring, `attendanceController.js` handles only attendance routes). No giant catch-all files.
- **Use clear, descriptive naming.** Variables, functions, and files should be self-explanatory (`calculateRiskScore()`, not `calc()` or `doStuff()`). A panelist should be able to read a function name and guess what it does.
- **Avoid unnecessary complexity/cleverness.** Prefer simple, readable code over "clever" one-liners — this needs to be explainable under pressure, not just functional.
- **Consistent structure across modules.** Each module (records, attendance, enrollment, risk) should follow the same folder/file pattern (e.g. `routes/`, `controllers/`, `models/`) so the codebase is predictable and easy to navigate.
- **Separate config from logic.** Thresholds, formulas, and constants (risk weights, grade/attendance thresholds) live in a dedicated config file — never hardcoded inline — so they're easy to point to and explain.
- **Add README notes per module** (or at minimum in CLAUDE.md) briefly explaining what each module does and how it connects to the others, for quick orientation before a defense/debugging session.
- When asking Claude Code to build something, explicitly include "add clear comments" and "keep this readable/well-structured" in the prompt if it's a complex feature (like the risk formula) — don't assume it by default.
