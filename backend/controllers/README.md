# `controllers/` — request handlers

One file per feature, matching the route file that mounts it. A controller
reads the request, decides whether this user may do this thing, calls models
and services, and shapes the response. It holds no SQL and no formula.

## The authorization rule

Role is checked at the route (`requireRole`) only where a role is genuinely
the boundary — admin-only setup pages, the principal's verification queue.

Everywhere else the boundary is **assignment, not job title**, and it is
checked here:

- `dailyAttendanceController.assertCanWriteSection` — admin/registrar, or
  this section's `adviser_id`.
- `subjectAttendanceController.assertCanWriteOffering` — admin, or this
  offering's `teacher_id`. Registrar is deliberately *not* included: the
  daily register is an administrative record, a subject's is the teacher's.

Both are exported and reused by the bulk importer, so the two paths cannot
drift apart. A person labelled `adviser` who does not advise *this* section
has no more right to it than anyone else.

`userController.assertCanActOnTarget` is the equivalent for accounts: an
admin account may only be acted on by that same admin.

## Shaping responses

Every path that returns a student passes it through `stripLearnerStatus`
(`utils/learnerStatusVisibility.js`) — hiding a field in the UI leaves it in
the JSON for anyone who opens devtools, which for a minor's disability
status is not an acceptable boundary. The same map gates writes.

## Multi-step flows

The two importers are four and five stateless steps. Nothing is stored
between them: the browser holds the parsed data and sends it back, so there
is no staging table and nothing to clean up if someone closes the tab.

Both re-validate on commit rather than trusting what comes back. Step two
checked a payload the browser then held and could freely alter.
