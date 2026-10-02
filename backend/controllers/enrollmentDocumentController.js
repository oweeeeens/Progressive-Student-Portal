// Handlers for enrollment document upload/review. Scope is narrower than
// Student Records' visibility rules: only the student themselves, or
// admin/registrar, can see or touch enrollment documents at all (advisers/
// subject teachers/guidance counselors have no reason to — this is a
// registrar/student-facing workflow per CLAUDE.md's scope).
const enrollmentDocumentModel = require('../models/enrollmentDocumentModel');
const schoolYearModel = require('../models/schoolYearModel');
const studentModel = require('../models/studentModel');
const { fileStore } = require('../middleware/uploadMiddleware');
const { deleteStoredFile, absolutePathFor } = fileStore;
const { provisionStudentAccountIfReady } = require('../services/accountProvisioning');

const VALID_DOCUMENT_TYPES = ['report_card', 'birth_certificate', 'sf10', 'other'];
const VALID_REVIEW_STATUSES = ['verified', 'rejected'];

// "Can this user act on this student's enrollment documents at all" —
// students only ever themselves, admin/registrar any existing student.
async function resolveTargetStudent(req, res, studentId) {
  if (req.user.role === 'student') {
    const student = await studentModel.findById(req.user, studentId); // already scoped to self
    if (!student) res.status(404).json({ error: 'Student not found.' });
    return student;
  }
  const student = await studentModel.findByIdUnscoped(studentId);
  if (!student) res.status(404).json({ error: 'Student not found.' });
  return student;
}

async function uploadDocument(req, res) {
  const studentId = Number(req.params.studentId);
  const { documentType } = req.body;

  // From here on, any early return must clean up the file multer already
  // wrote to disk — otherwise a rejected upload leaves an orphaned file with
  // no DB record pointing at it.
  const cleanupAndRespond = (status, body) => {
    if (req.file) deleteStoredFile(req.file.filename);
    return res.status(status).json(body);
  };

  if (!req.file) {
    return res.status(400).json({ error: 'A file is required.' });
  }
  if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType)) {
    return cleanupAndRespond(400, { error: `documentType must be one of: ${VALID_DOCUMENT_TYPES.join(', ')}` });
  }

  const student = await resolveTargetStudent(req, res, studentId);
  if (!student) {
    if (req.file) deleteStoredFile(req.file.filename);
    return;
  }

  const schoolYear = await schoolYearModel.getCurrentSchoolYear();
  if (!schoolYear) {
    return cleanupAndRespond(400, { error: 'No current school year is configured.' });
  }

  const document = await enrollmentDocumentModel.create({
    studentId,
    schoolYearId: schoolYear.id,
    documentType,
    filePath: req.file.filename,
    originalFilename: req.file.originalname,
    uploadedBy: req.user.id,
  });
  res.status(201).json({ document });
}

// True once every required document type's latest submission is verified.
function allRequirementsVerified(requirements) {
  return requirements.every((r) => r.status === 'verified');
}

async function listForStudent(req, res) {
  const studentId = Number(req.params.studentId);
  const student = await resolveTargetStudent(req, res, studentId);
  if (!student) return;

  const documents = await enrollmentDocumentModel.listForStudent(studentId);
  const requirements = enrollmentDocumentModel.buildRequirementsSummary(documents);

  // Opportunistic self-heal: if documents were already fully verified before
  // this auto-advance feature existed (or some other path left the student
  // 'pending'), catch it up on the next view rather than requiring a backfill
  // script. markEnrolledIfPending is a no-op if the student isn't 'pending'.
  if (allRequirementsVerified(requirements)) {
    await studentModel.markEnrolledIfPending(studentId);
  }

  res.json({ documents, requirements });
}

async function listQueue(req, res) {
  const { status, documentType, search, page, pageSize } = req.query;
  const result = await enrollmentDocumentModel.listAll({
    status,
    documentType,
    search,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });
  res.json(result);
}

async function getStats(req, res) {
  const counts = await enrollmentDocumentModel.countsByStatus();
  res.json({ counts });
}

async function reviewDocument(req, res) {
  const { status, reviewNote } = req.body;
  if (!VALID_REVIEW_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_REVIEW_STATUSES.join(', ')}` });
  }

  const existing = await enrollmentDocumentModel.getById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Document not found.' });

  const document = await enrollmentDocumentModel.review(existing.id, { status, reviewNote, verifiedBy: req.user.id });

  // Approving a document can be the one that completes the required set —
  // check and auto-advance the student from 'pending' to 'enrolled' when
  // that happens. A rejection can never complete the set, so skip the check.
  let autoEnrolled = false;
  let accountProvisioned = null;
  if (status === 'verified') {
    const allVerified = await enrollmentDocumentModel.areAllRequiredDocumentsVerified(document.student_id);
    if (allVerified) {
      autoEnrolled = await studentModel.markEnrolledIfPending(document.student_id);
    }
    // Self-checking no-op unless this review is what just made the student
    // 'enrolled' (or they were already enrolled with no account yet) — see
    // services/accountProvisioning.js.
    accountProvisioned = await provisionStudentAccountIfReady(document.student_id);
  }

  res.json({ document, autoEnrolled, accountProvisioned });
}

async function downloadFile(req, res) {
  const document = await enrollmentDocumentModel.getById(Number(req.params.id));
  if (!document) return res.status(404).json({ error: 'Document not found.' });

  const student = await resolveTargetStudent(req, res, document.student_id);
  if (!student) return;

  res.download(absolutePathFor(document.file_path), document.original_filename, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File not found on disk.' });
    }
  });
}

async function deleteDocument(req, res) {
  const document = await enrollmentDocumentModel.getById(Number(req.params.id));
  if (!document) return res.status(404).json({ error: 'Document not found.' });

  if (req.user.role === 'student') {
    const student = await studentModel.findById(req.user, document.student_id);
    if (!student) return res.status(404).json({ error: 'Document not found.' });
    if (document.status !== 'pending') {
      return res.status(403).json({ error: 'Only a pending (not yet reviewed) document can be deleted.' });
    }
  }

  await enrollmentDocumentModel.remove(document.id);
  deleteStoredFile(document.file_path);
  res.status(204).end();
}

module.exports = { uploadDocument, listForStudent, listQueue, getStats, reviewDocument, downloadFile, deleteDocument };
