// The panel's reports (panel revision, 2026-11-18). Each report answers in
// three forms from ONE data object — JSON for the page, PDF and Excel for
// export — so a downloaded file always says exactly what the screen said.
//
// Access is by ASSIGNMENT, like every other permission in this system:
//   gradesheet       the section's adviser (sections.adviser_id) or the admin
//   class grades     the class's teacher (class_offerings.teacher_id) or the admin
//   enrolled list    the registrar or the admin
const reportModel = require('../models/reportModel');
const enrollmentModel = require('../models/enrollmentModel');
const { buildGradesheet, buildClassGrades, buildEnrolledList } = require('../services/reportBuilder');
const { buildGradesheetPdf, buildClassGradesPdf, buildEnrolledListPdf } = require('../services/reportPdf');
const { buildGradesheetWorkbook, buildClassGradesWorkbook, buildEnrolledListWorkbook } = require('../services/reportWorkbook');

// The students.enrollment_status values (migration create-students).
const ENROLLMENT_STATUSES = ['enrolled', 'pending', 'dropped', 'transferred', 'graduated'];

const PDF_TYPE = 'application/pdf';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A filename-safe slug: "Grade 11 STEM A" → "grade-11-stem-a".
const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dateStamp = (d) => d.toISOString().slice(0, 10);

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Sends one report in the requested form.
async function sendReport(res, format, data, { pdf, workbook, filename }) {
  if (format === 'pdf') {
    const doc = pdf(data);
    res.setHeader('Content-Type', PDF_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);
    doc.end();
    return;
  }
  if (format === 'excel') {
    const buffer = await workbook(data);
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(Buffer.from(buffer));
    return;
  }
  res.json(data);
}

// ADVISER GRADESHEET — GET /api/reports/gradesheet?sectionId=  (+ /export/pdf|excel)
function gradesheet(format) {
  return async (req, res) => {
    const sectionId = positiveId(req.query.sectionId);
    if (!sectionId) return res.status(400).json({ error: 'Choose a section.' });
    const header = await reportModel.getSectionHeader(sectionId);
    if (!header) return res.status(404).json({ error: 'Section not found.' });
    if (req.user.role !== 'admin' && header.adviser_id !== req.user.id) {
      return res.status(403).json({ error: 'A gradesheet is for the section\'s own adviser (or the admin).' });
    }
    const [periods, offerings, students] = await Promise.all([
      reportModel.listPeriods(header.school_year_id),
      reportModel.listSectionOfferings(sectionId),
      reportModel.listSectionStudents(sectionId),
    ]);
    const grades = await reportModel.listFinalizedGrades(offerings.map((o) => o.id), students.map((s) => s.id));
    const data = buildGradesheet({ header, periods, offerings, students, grades });
    return sendReport(res, format, data, {
      pdf: buildGradesheetPdf,
      workbook: buildGradesheetWorkbook,
      filename: `Gradesheet-grade-${header.grade_level}-${slug(header.name)}-${dateStamp(data.generatedAt)}`,
    });
  };
}

// SUBJECT TEACHER'S CLASS GRADE REPORT — GET /api/reports/class-grades?classOfferingId=
function classGrades(format) {
  return async (req, res) => {
    const offeringId = positiveId(req.query.classOfferingId);
    if (!offeringId) return res.status(400).json({ error: 'Choose a class.' });
    const header = await reportModel.getOfferingHeader(offeringId);
    if (!header) return res.status(404).json({ error: 'Class not found.' });
    if (req.user.role !== 'admin' && header.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'A class grade report is for the class\'s own teacher (or the admin).' });
    }
    const [periods, students, grades] = await Promise.all([
      reportModel.listPeriods(header.school_year_id),
      // The class roster: learners ENROLLED in it (class_enrollments).
      enrollmentModel.getEnrolledStudents(offeringId),
      reportModel.listOfferingGrades(offeringId),
    ]);
    const data = buildClassGrades({ header, periods, students, grades });
    return sendReport(res, format, data, {
      pdf: buildClassGradesPdf,
      workbook: buildClassGradesWorkbook,
      filename: `Class-grades-${slug(header.subject_name)}-${slug(header.section_name)}-${dateStamp(data.generatedAt)}`,
    });
  };
}

// ENROLLED STUDENT LIST — GET /api/reports/enrolled-students?gradeLevel=&sectionId=&strand=
// The registrar's list (and the admin's): school-wide by nature, so this
// one is role-based — keeping the student register is the registrar's job.
function enrolledStudents(format) {
  return async (req, res) => {
    if (!['admin', 'registrar'].includes(req.user.role)) {
      return res.status(403).json({ error: 'The enrolled student list is for the registrar and the admin.' });
    }
    const filters = {
      gradeLevel: req.query.gradeLevel ? Number(req.query.gradeLevel) : null,
      sectionId: req.query.sectionId ? positiveId(req.query.sectionId) : null,
      strand: req.query.strand ? String(req.query.strand).slice(0, 40) : null,
      // An ENROLLED list by default: a dropped or transferred learner is not
      // enrolled. "all" includes every status; any single status may be asked for.
      status: req.query.status || 'enrolled',
    };
    if (
      (req.query.gradeLevel && ![11, 12].includes(filters.gradeLevel)) ||
      (req.query.sectionId && !filters.sectionId) ||
      !['all', ...ENROLLMENT_STATUSES].includes(filters.status)
    ) {
      return res.status(400).json({ error: 'That filter is not valid.' });
    }
    const [students, sections] = await Promise.all([
      reportModel.listEnrolledStudents({ ...filters, status: filters.status === 'all' ? null : filters.status }),
      reportModel.listCurrentSections(),
    ]);
    const data = buildEnrolledList({ students, sections, filters });
    return sendReport(res, format, data, {
      pdf: buildEnrolledListPdf,
      workbook: buildEnrolledListWorkbook,
      filename: `Enrolled-students-${dateStamp(data.generatedAt)}`,
    });
  };
}

module.exports = { gradesheet, classGrades, enrolledStudents };
