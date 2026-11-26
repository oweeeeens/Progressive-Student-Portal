// Mounted at /api/reports — the panel's reports (panel revision, 2026-11-18).
//
// No requireRole here on purpose for the grade reports: who may open them is
// decided by ASSIGNMENT (the section's adviser, the class's teacher), which
// the controller checks against the specific section or class requested.
const express = require('express');
const { gradesheet, gradesheetSections, classGrades, allClassGrades, enrolledStudents } = require('../controllers/reportController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);

// Adviser gradesheet: finalized grades, section × subjects, per grading period.
// The sections this user may open a gradesheet for (the page's picker).
router.get('/gradesheet/sections', gradesheetSections);
router.get('/gradesheet', gradesheet('json'));
router.get('/gradesheet/export/pdf', gradesheet('pdf'));
router.get('/gradesheet/export/excel', gradesheet('excel'));

// Subject teacher's class grade report: enrolled learners × periods, with status.
router.get('/class-grades', classGrades('json'));
router.get('/class-grades/export/pdf', classGrades('pdf'));
router.get('/class-grades/export/excel', classGrades('excel'));
// Every class the teacher teaches (the admin: every class, optionally one section).
router.get('/class-grades/all', allClassGrades('json'));
router.get('/class-grades/all/export/pdf', allClassGrades('pdf'));
router.get('/class-grades/all/export/excel', allClassGrades('excel'));

// Enrolled student list: registrar and admin (checked in the handler).
router.get('/enrolled-students', enrolledStudents('json'));
router.get('/enrolled-students/export/pdf', enrolledStudents('pdf'));
router.get('/enrolled-students/export/excel', enrolledStudents('excel'));

module.exports = router;
