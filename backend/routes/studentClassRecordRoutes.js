// Mounted at /api/students/:studentId/class-record.
//
// One learner's complete class record — every subject, term, item and score,
// with the DepEd computation. Scoped exactly like the learner's grades
// (loadScopedStudent → studentModel.findById): their adviser, the teachers of
// their section, the school-wide reading roles, and the learner themselves.
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { loadScopedStudent } = require('../middleware/loadScopedStudent');
const studentModel = require('../models/studentModel');
const gradingPeriodModel = require('../models/gradingPeriodModel');
const { buildStudentClassRecord } = require('../services/classRecordService');
const { todayInSchoolTimezone } = require('../utils/schoolDate');
const { PASSING_GRADE } = require('../config/gradingPolicy');

const router = express.Router({ mergeParams: true });
router.use(requireAuth, loadScopedStudent);

router.get('/', async (req, res) => {
  const studentId = req.scopedStudent.id;
  const schoolYearId = await studentModel.resolveSchoolYearId(studentId);
  if (!schoolYearId) return res.json({ gradingPeriods: [], subjects: [], currentPeriodId: null, passingGrade: PASSING_GRADE });
  const gradingPeriods = await gradingPeriodModel.listBySchoolYear(schoolYearId);
  const today = todayInSchoolTimezone();
  const current = gradingPeriods.find((p) => String(p.start_date).slice(0, 10) <= today && today <= String(p.end_date).slice(0, 10));
  const { subjects } = await buildStudentClassRecord(studentId, schoolYearId, gradingPeriods);
  res.json({ gradingPeriods, subjects, currentPeriodId: current ? current.id : null, passingGrade: PASSING_GRADE });
});

module.exports = router;
