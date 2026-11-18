// Mounted at /api/reports — the panel's reports (panel revision, 2026-11-18).
//
// No requireRole here on purpose for the grade reports: who may open them is
// decided by ASSIGNMENT (the section's adviser, the class's teacher), which
// the controller checks against the specific section or class requested.
const express = require('express');
const { gradesheet, classGrades } = require('../controllers/reportController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

// Adviser gradesheet: finalized grades, section × subjects, per grading period.
router.get('/gradesheet', gradesheet('json'));
router.get('/gradesheet/export/pdf', gradesheet('pdf'));
router.get('/gradesheet/export/excel', gradesheet('excel'));

// Subject teacher's class grade report: enrolled learners × periods, with status.
router.get('/class-grades', classGrades('json'));
router.get('/class-grades/export/pdf', classGrades('pdf'));
router.get('/class-grades/export/excel', classGrades('excel'));

module.exports = router;
