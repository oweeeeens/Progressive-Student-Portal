// Owns all reads/writes against the students table. Role-based visibility
// scoping (adviser -> own section, subject teacher -> own classes, student ->
// self) lives here rather than in the controller, so there is exactly one
// place that decides "which students can this user see."
const { pool } = require('../config/db');

const LIST_COLUMNS = `
  s.id, s.lrn, s.first_name, s.middle_name, s.last_name, s.sex, s.date_of_birth,
  s.address, s.email, s.guardian_name, s.guardian_contact_number, s.enrollment_status,
  s.is_active, s.user_id, s.current_section_id, sec.name AS section_name, sec.grade_level,
  sec.strand, s.is_pwd, s.is_4ps, s.is_als_graduate, s.created_at, s.updated_at
`;

const BASE_FROM = `
  FROM students s
  LEFT JOIN sections sec ON sec.id = s.current_section_id
`;

// The student's most recently calculated risk level, regardless of which
// grading period that was — not "only if today's period has one", since a
// student with a real Q1 result but no Q2 calculation yet still has a
// known standing worth showing, not a blank. LATERAL + LIMIT 1 picks the
// single latest-period row per student without a GROUP BY.
const LATEST_RISK_JOIN = `
  LEFT JOIN LATERAL (
    SELECT ra.risk_level
    FROM risk_assessments ra
    JOIN grading_periods gp ON gp.id = ra.grading_period_id
    WHERE ra.student_id = s.id
    ORDER BY gp.sequence_number DESC
    LIMIT 1
  ) latest_risk ON TRUE
`;

// Only ever used to pick one of these two fixed SQL fragments — sortBy and
// sortDir from the request never reach the query string directly.
const SORT_COLUMNS = {
  name: 's.last_name, s.first_name',
  status: 's.enrollment_status, s.last_name, s.first_name',
};

// Appends the WHERE clause fragment (and its bound params) that restricts
// which students a given user is allowed to see. admin/registrar/
// guidance_counselor get no restriction here — guidance counselors will get
// narrowed to flagged/at-risk students if that's ever requested; for now
// they see the full roster, same as admin/registrar.
function appendScopeClause(user, clauses, params) {
  switch (user.role) {
    case 'admin':
    case 'registrar':
    case 'guidance_counselor':
    // The principal is a single school-wide position (CLAUDE.md), and the
    // rest of the app already treats them that way: they verify every
    // submitted grade in the school, and the Analytics dashboard shows them
    // named at-risk students with their risk levels. Falling through to the
    // default below meant those names were visible in the rollup but every
    // link to one returned 404 — the data wasn't protected, only the
    // navigation was broken. Read scope only; writes stay admin/registrar
    // via the route-level gate in routes/studentRoutes.js.
    case 'principal':
      return;
    case 'adviser':
      params.push(user.id);
      clauses.push(`sec.adviser_id = $${params.length}`);
      return;
    case 'subject_teacher':
      // "Taught by this teacher" is a property of the section row itself
      // (sections are per-school-year, so a section's id already pins it to
      // one year) — no separate school_year filter needed.
      params.push(user.id);
      clauses.push(`EXISTS (
        SELECT 1 FROM class_offerings co
        WHERE co.section_id = s.current_section_id AND co.teacher_id = $${params.length}
      )`);
      return;
    case 'student':
      params.push(user.id);
      clauses.push(`s.user_id = $${params.length}`);
      return;
    default:
      // Unknown role: fail closed rather than leaking the full roster.
      clauses.push('FALSE');
  }
}

// Request-key -> column, for the learner-status reporting filters below.
const LEARNER_STATUS_COLUMNS = { isPwd: 'is_pwd', is4ps: 'is_4ps', isAlsGraduate: 'is_als_graduate' };

async function listStudents(
  user,
  {
    search,
    gradeLevel,
    sectionId,
    status,
    includeInactive,
    hasAccount,
    learnerStatus,
    sortBy,
    sortDir,
    page = 1,
    pageSize = 20,
  } = {}
) {
  const clauses = [];
  const params = [];

  if (!includeInactive) {
    clauses.push('s.is_active = TRUE');
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.lrn ILIKE $${params.length})`);
  }
  if (gradeLevel) {
    params.push(gradeLevel);
    clauses.push(`sec.grade_level = $${params.length}`);
  }
  if (sectionId) {
    params.push(sectionId);
    clauses.push(`s.current_section_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`s.enrollment_status = $${params.length}`);
  }
  // Used by User Management's "Pending Student Accounts" tab to find
  // students eligible for the bulk account-creation action — hasAccount is
  // a plain boolean, not tri-state, since "don't filter on this at all" is
  // already expressed by leaving the param out entirely.
  if (hasAccount === true) {
    clauses.push('s.user_id IS NOT NULL');
  } else if (hasAccount === false) {
    clauses.push('s.user_id IS NULL');
  }
  // Learner-status reporting filters ("pull every PWD learner"). Only ever
  // filters FOR the flag, never against it — the school's use case is
  // producing a DepEd list, not excluding those learners from the roster.
  // WHICH of these a caller may use is gated in the controller against the
  // same visibility map that strips the fields from responses; allowing a
  // filter on a field someone can't read would leak it by inference.
  for (const key of ['isPwd', 'is4ps', 'isAlsGraduate']) {
    if (learnerStatus && learnerStatus[key]) {
      clauses.push(`s.${LEARNER_STATUS_COLUMNS[key]} = TRUE`);
    }
  }
  appendScopeClause(user, clauses, params);

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderSql = `ORDER BY ${SORT_COLUMNS[sortBy] || SORT_COLUMNS.name} ${sortDir === 'desc' ? 'DESC' : 'ASC'}`;

  const countResult = await pool.query(`SELECT COUNT(*) ${BASE_FROM} ${whereSql}`, params);
  const total = Number(countResult.rows[0].count);

  const limit = Math.min(Number(pageSize) || 20, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const dataParams = [...params, limit, offset];

  const dataResult = await pool.query(
    `SELECT ${LIST_COLUMNS}, latest_risk.risk_level
     ${BASE_FROM}
     ${LATEST_RISK_JOIN}
     ${whereSql}
     ${orderSql}
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  return { students: dataResult.rows, total, page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

// The single-student view carries one column the list doesn't: who advises
// their section. Joined here rather than in BASE_FROM/LIST_COLUMNS because
// those are shared with the roster list and with interventionModel, and a
// name nobody renders there isn't worth adding to every one of those rows.
async function findById(user, studentId) {
  const clauses = ['s.id = $1'];
  const params = [studentId];
  appendScopeClause(user, clauses, params);

  const result = await pool.query(
    `SELECT ${LIST_COLUMNS}, adviser.full_name AS adviser_name
     ${BASE_FROM}
     LEFT JOIN users adviser ON adviser.id = sec.adviser_id
     WHERE ${clauses.join(' AND ')}`,
    params
  );
  return result.rows[0] || null;
}

async function createStudent(data) {
  const result = await pool.query(
    `INSERT INTO students
       (lrn, first_name, middle_name, last_name, sex, date_of_birth, address, email,
        guardian_name, guardian_contact_number, current_section_id, enrollment_status,
        is_pwd, is_4ps, is_als_graduate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      data.lrn,
      data.firstName,
      data.middleName || null,
      data.lastName,
      data.sex || null,
      data.dateOfBirth,
      data.address || null,
      data.email || null,
      data.guardianName || null,
      data.guardianContactNumber || null,
      data.currentSectionId || null,
      // 'enrolled', not 'pending' — enrollment now happens on paper before a
      // student's record is ever added here (see CLAUDE.md's "REMOVED:
      // Enrollment Management"), so by the time a registrar is creating this
      // record the student has already enrolled. 'pending' stays a valid,
      // selectable status for the rare case it's still genuinely needed
      // (e.g. a record entered ahead of paperwork being finalized).
      data.enrollmentStatus || 'enrolled',
      // Descriptive reporting flags — default false rather than null, same
      // reasoning as the column defaults (see the migration).
      data.isPwd === true,
      data.is4ps === true,
      data.isAlsGraduate === true,
    ]
  );
  return result.rows[0].id;
}

// Partial update: only columns present in `data` are touched.
const UPDATABLE_FIELDS = {
  lrn: 'lrn',
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  sex: 'sex',
  dateOfBirth: 'date_of_birth',
  address: 'address',
  email: 'email',
  guardianName: 'guardian_name',
  guardianContactNumber: 'guardian_contact_number',
  currentSectionId: 'current_section_id',
  enrollmentStatus: 'enrollment_status',
  isPwd: 'is_pwd',
  is4ps: 'is_4ps',
  isAlsGraduate: 'is_als_graduate',
};

async function updateStudent(studentId, data) {
  const setClauses = [];
  const params = [];

  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      params.push(data[key]);
      setClauses.push(`${column} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) {
    const existing = await pool.query('SELECT id FROM students WHERE id = $1', [studentId]);
    return existing.rows[0] || null;
  }

  setClauses.push('updated_at = now()');
  params.push(studentId);

  const result = await pool.query(
    `UPDATE students SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  return result.rows[0] || null;
}

async function setActive(studentId, isActive) {
  const result = await pool.query(
    'UPDATE students SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING id',
    [isActive, studentId]
  );
  return result.rows[0] || null;
}

// Unscoped lookup for internal use right after a write (we already know the
// caller is authorized because they just performed the write).
async function findByIdUnscoped(studentId) {
  const result = await pool.query(
    `SELECT ${LIST_COLUMNS} ${BASE_FROM} WHERE s.id = $1`,
    [studentId]
  );
  return result.rows[0] || null;
}

// Lean, internal-use lookup for studentController.resetPassword — just the
// fields needed to check whether this student has a portal account to reset
// (user_id), not the full public profile shape.
async function getAccountProvisioningInfo(studentId) {
  const result = await pool.query(
    'SELECT id, email, user_id, enrollment_status, first_name, last_name FROM students WHERE id = $1',
    [studentId]
  );
  return result.rows[0] || null;
}

async function linkUserAccount(studentId, userId) {
  await pool.query('UPDATE students SET user_id = $1, updated_at = now() WHERE id = $2', [userId, studentId]);
}

// Summary counts for the Student List page's stat cards — scoped by the
// same appendScopeClause rule as the list itself, so an adviser's totals
// cover only their own section rather than the whole school.
async function countsByEnrollmentStatus(user) {
  const clauses = ['s.is_active = TRUE'];
  const params = [];
  appendScopeClause(user, clauses, params);

  const result = await pool.query(
    `SELECT s.enrollment_status, COUNT(*)::int AS count
     ${BASE_FROM}
     WHERE ${clauses.join(' AND ')}
     GROUP BY s.enrollment_status`,
    params
  );

  const counts = { total: 0, pending: 0, enrolled: 0, dropped: 0, transferred: 0, graduated: 0 };
  for (const row of result.rows) {
    counts[row.enrollment_status] = row.count;
    counts.total += row.count;
  }
  return counts;
}

module.exports = {
  listStudents,
  findById,
  findByIdUnscoped,
  createStudent,
  updateStudent,
  setActive,
  getAccountProvisioningInfo,
  linkUserAccount,
  countsByEnrollmentStatus,
  // Exported so dashboardModel can reuse the exact same "which students can
  // this user see" rule instead of reimplementing it.
  appendScopeClause,
  BASE_FROM,
};
