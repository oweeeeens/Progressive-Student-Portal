// Owns all reads/writes against enrollment_documents. Each upload is its own
// row (never overwritten in place), so a rejected submission and its later
// resubmission both stay visible — registrar sees the full history, not just
// the latest state.
const { pool } = require('../config/db');
const { REQUIRED_DOCUMENT_TYPES } = require('../config/enrollment');

const COLUMNS = `
  id, student_id, school_year_id, document_type, file_path, original_filename,
  status, review_note, uploaded_by, verified_by, verified_at, uploaded_at
`;

async function create({ studentId, schoolYearId, documentType, filePath, originalFilename, uploadedBy }) {
  const result = await pool.query(
    `INSERT INTO enrollment_documents
       (student_id, school_year_id, document_type, file_path, original_filename, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [studentId, schoolYearId, documentType, filePath, originalFilename, uploadedBy]
  );
  return result.rows[0];
}

async function getById(id) {
  const result = await pool.query(`SELECT ${COLUMNS} FROM enrollment_documents WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function listForStudent(studentId) {
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM enrollment_documents WHERE student_id = $1 ORDER BY uploaded_at DESC`,
    [studentId]
  );
  return result.rows;
}

// A per-required-type checklist: what's the latest submission's state for
// each of report_card/birth_certificate/sf10, or "missing" if none exists
// yet. Built from the same rows listForStudent returns, not a second query.
function buildRequirementsSummary(documents) {
  return REQUIRED_DOCUMENT_TYPES.map((documentType) => {
    const latest = documents.find((d) => d.document_type === documentType) || null; // already DESC by uploaded_at
    return {
      documentType,
      status: latest ? latest.status : 'missing',
      latestDocument: latest,
    };
  });
}

// Used to decide whether to auto-advance a student's enrollment_status —
// see studentModel.markEnrolledIfPending.
async function areAllRequiredDocumentsVerified(studentId) {
  const documents = await listForStudent(studentId);
  const requirements = buildRequirementsSummary(documents);
  return requirements.every((r) => r.status === 'verified');
}

async function listAll({ status, documentType, search, page = 1, pageSize = 20 } = {}) {
  const clauses = [];
  const params = [];

  if (status) {
    params.push(status);
    clauses.push(`ed.status = $${params.length}`);
  }
  if (documentType) {
    params.push(documentType);
    clauses.push(`ed.document_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.lrn ILIKE $${params.length})`);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM enrollment_documents ed JOIN students s ON s.id = ed.student_id ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0].count);

  const limit = Math.min(Number(pageSize) || 20, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];

  const dataResult = await pool.query(
    `SELECT ed.id, ed.document_type, ed.status, ed.review_note, ed.uploaded_at, ed.verified_at,
            s.id AS student_id, s.first_name, s.last_name, s.lrn
     FROM enrollment_documents ed
     JOIN students s ON s.id = ed.student_id
     ${whereSql}
     ORDER BY ed.uploaded_at DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  return { documents: dataResult.rows, total, page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

// Summary counts for the Enrollment Review page's stat cards.
async function countsByStatus() {
  const result = await pool.query('SELECT status, COUNT(*)::int AS count FROM enrollment_documents GROUP BY status');
  const counts = { pending: 0, verified: 0, rejected: 0 };
  for (const row of result.rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

async function review(id, { status, reviewNote, verifiedBy }) {
  const result = await pool.query(
    `UPDATE enrollment_documents
     SET status = $1, review_note = $2, verified_by = $3, verified_at = now()
     WHERE id = $4
     RETURNING ${COLUMNS}`,
    [status, reviewNote || null, verifiedBy, id]
  );
  return result.rows[0] || null;
}

async function remove(id) {
  const result = await pool.query(`DELETE FROM enrollment_documents WHERE id = $1 RETURNING ${COLUMNS}`, [id]);
  return result.rows[0] || null;
}

module.exports = {
  create,
  getById,
  listForStudent,
  buildRequirementsSummary,
  areAllRequiredDocumentsVerified,
  listAll,
  countsByStatus,
  review,
  remove,
};
