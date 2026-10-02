// Owns reads/writes against announcements. No role-based visibility scoping
// here, unlike studentModel — announcements are visible to every
// authenticated role by design (see announcementController.js), so there's
// nothing to filter on read.
const { pool } = require('../config/db');

const COLUMNS = `
  a.id, a.title, a.body, a.file_path, a.original_filename, a.posted_by,
  a.created_at, a.updated_at, u.full_name AS posted_by_name, u.role AS posted_by_role
`;
const BASE_FROM = 'FROM announcements a JOIN users u ON u.id = a.posted_by';

async function list({ page = 1, pageSize = 10 } = {}) {
  const countResult = await pool.query('SELECT COUNT(*) FROM announcements');
  const total = Number(countResult.rows[0].count);

  const limit = Math.min(Number(pageSize) || 10, 50);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const dataResult = await pool.query(
    `SELECT ${COLUMNS} ${BASE_FROM} ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return { announcements: dataResult.rows, total, page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

async function getById(id) {
  const result = await pool.query(`SELECT ${COLUMNS} ${BASE_FROM} WHERE a.id = $1`, [id]);
  return result.rows[0] || null;
}

async function create({ title, body, filePath, originalFilename, postedBy }) {
  const result = await pool.query(
    `INSERT INTO announcements (title, body, file_path, original_filename, posted_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [title, body, filePath || null, originalFilename || null, postedBy]
  );
  return result.rows[0].id;
}

// Partial update: only columns present in `data` are touched, same pattern
// as studentModel.updateStudent.
const UPDATABLE_FIELDS = { title: 'title', body: 'body', filePath: 'file_path', originalFilename: 'original_filename' };

async function update(id, data) {
  const setClauses = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      params.push(data[key]);
      setClauses.push(`${column} = $${params.length}`);
    }
  }
  if (setClauses.length === 0) return { id };

  setClauses.push('updated_at = now()');
  params.push(id);

  const result = await pool.query(
    `UPDATE announcements SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  return result.rows[0] || null;
}

async function remove(id) {
  const result = await pool.query('DELETE FROM announcements WHERE id = $1 RETURNING id, file_path', [id]);
  return result.rows[0] || null;
}

module.exports = { list, getById, create, update, remove };
