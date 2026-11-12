// Mounted at /api/students/:studentId/insights.
//
// Analytics for ONE learner: the Learner Outlook views (DepEd Order No. 015,
// s. 2026, ¶67/¶68/¶70) applied to this learner alone, for the "Learner
// Insights" tab on their record and "How you're doing" on their own
// My Progress.
//
// Why here and not as a filter on the Analytics page: Analytics is a rollup
// across learners; per-learner analysis belongs on the learner's record,
// which is already scoped correctly (loadScopedStudent → studentModel.findById
// — their adviser, the teachers of their section, the school-wide reading
// roles, and the learner). Nobody can see insights for a learner whose
// record they could not already open.
//
// No new formulas: the same outlookCalculator functions and the same DepEd
// grade computation the section-level views use, fed this learner's rows.
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { loadScopedStudent } = require('../middleware/loadScopedStudent');
const studentModel = require('../models/studentModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const outlookModel = require('../models/outlookModel');
const { buildStudentClassRecord } = require('../services/classRecordService');
const { promotionOutlook, subjectGradesSoFar, componentProfile, earlyWarning } = require('../services/outlookCalculator');
const outlookConfig = require('../config/outlookConfig');
const { todayInSchoolTimezone } = require('../utils/schoolDate');

const round1 = (v) => Math.round(v * 10) / 10;

const router = express.Router({ mergeParams: true });
router.use(requireAuth, loadScopedStudent);

router.get('/', async (req, res) => {
  const student = req.scopedStudent;
  const schoolYearId = await studentModel.resolveSchoolYearId(student.id);
  if (!schoolYearId) return res.json({ empty: true, thresholds: outlookConfig });

  const periods = await gradingPeriodModel.listBySchoolYear(schoolYearId);
  const today = todayInSchoolTimezone();
  const current =
    periods.find((p) => String(p.start_date).slice(0, 10) <= today && today <= String(p.end_date).slice(0, 10)) ||
    [...periods].reverse().find((p) => String(p.start_date).slice(0, 10) <= today) ||
    periods[0] ||
    null;

  // Official record: finalized grades this year → promotion outlook (¶67)
  // and each subject's grade so far, with its term-by-term trend.
  const gradeRows = (await outlookModel.getFinalizedGradesForYear(schoolYearId)).filter((r) => r.student_id === student.id);
  const promotion = promotionOutlook(gradeRows);
  const standing = subjectGradesSoFar(gradeRows)
    .map((s) => ({
      classOfferingId: s.classOfferingId,
      subjectName: s.subjectName,
      grade: s.grade,
      termsCounted: s.termsCounted,
      terms: gradeRows
        .filter((r) => r.class_offering_id === s.classOfferingId)
        .sort((a, b) => a.sequence_number - b.sequence_number)
        .map((r) => ({ sequence: r.sequence_number, grade: Number(r.grade_value) })),
    }))
    .sort((a, b) => a.grade - b.grade);

  // This term's class record → strengths/weaknesses and the provisional
  // early warning (¶68). Provisional: never the official risk score.
  let components = [];
  let overallComponents = [];
  let warning = { belowPassing: [], missingWork: [] };
  if (current) {
    const record = await buildStudentClassRecord(student.id, schoolYearId, [current]);
    const computations = record.subjects
      .filter((s) => s.terms[current.id]?.computed)
      .map((s) => ({
        studentId: student.id,
        name: `${student.last_name}, ${student.first_name}`,
        sectionName: '',
        classOfferingId: s.classOfferingId,
        subjectName: s.subjectName,
        computed: s.terms[current.id].computed,
      }));
    components = componentProfile(computations);
    // Provisional only: subjects whose grade this term is already finalized
    // are official and already in the outlook above.
    const finalizedIds = new Set(
      record.subjects.filter((s) => s.terms[current.id]?.grade?.status === 'finalized').map((s) => s.classOfferingId)
    );
    warning = earlyWarning(computations.filter((c) => !finalizedIds.has(c.classOfferingId)));
    // Across all subjects: the learner's average percentage per component.
    const totals = {};
    for (const subject of components) {
      for (const c of subject.components) {
        if (!totals[c.key]) totals[c.key] = { key: c.key, label: c.label, sum: 0, count: 0 };
        totals[c.key].sum += c.average;
        totals[c.key].count += 1;
      }
    }
    overallComponents = Object.values(totals).map((t) => ({ key: t.key, label: t.label, average: round1(t.sum / t.count), subjects: t.count }));
  }

  // Attendance this year against the twelve-absence mark (¶70).
  const absenceRow = (await outlookModel.getAbsenceCountsForYear(schoolYearId)).find((r) => r.student_id === student.id);
  const absent = absenceRow ? Number(absenceRow.absent) : 0;
  const excused = absenceRow ? Number(absenceRow.excused) : 0;
  const recordedDays = absenceRow ? Number(absenceRow.recorded_days) : 0;
  const absences = absent + excused;

  res.json({
    thresholds: outlookConfig,
    periodName: current ? current.name : null,
    promotion: promotion.learners[0] || null,
    standing,
    components,
    overallComponents,
    provisional: {
      belowPassing: warning.belowPassing.map(({ subjectName, provisionalGrade, classOfferingId }) => ({ subjectName, provisionalGrade, classOfferingId })),
      missingWork: warning.missingWork.map(({ subjectName, missing, missingCount, classOfferingId }) => ({ subjectName, missing, missingCount, classOfferingId })),
    },
    attendance: {
      absent,
      excused,
      absences,
      recordedDays,
      attendanceRate: recordedDays > 0 ? round1(((recordedDays - absences) / recordedDays) * 100) : null,
      untilAlert: Math.max(0, outlookConfig.ABSENCE_ALERT_DAYS - absences),
      level: absences >= outlookConfig.ABSENCE_ALERT_DAYS ? 'alert' : absences >= outlookConfig.ABSENCE_APPROACHING_DAYS ? 'approaching' : 'ok',
    },
  });
});

module.exports = router;
