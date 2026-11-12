// The thresholds behind Analytics' "Learner Outlook" tab, in one place.
//
// Every figure comes from DepEd Order No. 015, s. 2026 (read from the signed
// order, Section VIII):
//
//   ¶67  Promotion: a learner who passes every learning area is promoted;
//        one who fails AT MOST TWO attends Summer Remedial Class; one who
//        fails MORE THAN TWO is retained in the same grade level.
//   ¶68  Teachers remediate WITHIN the term — "as early as Week 5 following
//        the first ST" — learners consistently below expectations in WWs,
//        PTs and STs. That is the mandate for the early-warning view (the
//        provisional grade from the class record, before grades are final)
//        and for showing which component learners lose points in.
//   ¶70  Teachers intervene "by the end of Term 1 or when a learner reaches
//        approximately twelve (12) absences".
//
// The passing grade is the System's one 75 (gradingPolicy.PASSING_GRADE).
const { PASSING_GRADE } = require('./gradingPolicy');

module.exports = {
  PASSING_GRADE,
  // ¶67: more failed learning areas than this means retention.
  PROMOTION_FAIL_LIMIT: 2,
  // ¶70: the absence count at which the order expects an intervention.
  ABSENCE_ALERT_DAYS: 12,
  // Shown as "approaching" from here, so the adviser can act before the
  // twelfth absence rather than after it. A System choice, not DepEd's.
  ABSENCE_APPROACHING_DAYS: 9,
  // A component percentage below this is counted as "struggling in" that
  // component on the where-points-are-lost view. 70% is the initial grade
  // that transmutes to the passing 75 (DO 015 Table 4), so a component
  // average under it is one that, on its own, would not pass.
  COMPONENT_STRUGGLE_PERCENT: 70,
};
