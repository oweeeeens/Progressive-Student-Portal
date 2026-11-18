// Links a staff account to the section it advises and the classes it
// teaches, from the account forms (New Account, Edit Account).
//
// Why this exists: every adviser and teacher feature is earned by an
// ASSIGNMENT — sections.adviser_id and class_offerings.teacher_id — never by
// the role label (see CLAUDE.md, "One person can hold two kinds of
// assignment"). Creating an account used to set only its name, email and
// role, so a new adviser signed in to a menu with almost nothing in it until
// someone separately found Academic Setup. Linking at creation closes that
// gap, using the same two columns Academic Setup writes.
//
// The rules, kept in one place for both endpoints:
//   - only the admin may link (Academic Setup is admin-only too);
//   - only the two teaching roles may hold a section or a class;
//   - only active sections and classes in the CURRENT school year — the
//     same filter as /sections/mine and /class-offerings/mine, so whatever
//     is linked here is exactly what the person will see when they sign in;
//   - a section has exactly one adviser, so linking one that already has an
//     adviser MOVES it (the form confirms first, naming who loses it).
const { pool } = require('../config/db');

const ASSIGNABLE_ROLES = ['adviser', 'subject_teacher'];

// Normalises the two optional request fields. Returns null when the request
// asks for no linking at all, so callers can skip every check below.
function readRequestedAssignments(body) {
  const sectionId = body.advisorySectionId === undefined || body.advisorySectionId === null || body.advisorySectionId === ''
    ? null
    : Number(body.advisorySectionId);
  const rawOfferings = Array.isArray(body.classOfferingIds) ? body.classOfferingIds : [];
  const offeringIds = [...new Set(rawOfferings.map(Number))];
  if (sectionId === null && offeringIds.length === 0) return null;
  return { sectionId, offeringIds };
}

// Checks who may link what, and loads each target with its current holder.
// Returns { ok: true, section, offerings } or { ok: false, status, error }.
async function validateAssignments(requested, { actorRole, targetRole }) {
  if (actorRole !== 'admin') {
    return { ok: false, status: 403, error: 'Only the admin can link an account to a section or class (Academic Setup is admin-only).' };
  }
  if (!ASSIGNABLE_ROLES.includes(targetRole)) {
    return { ok: false, status: 400, error: 'Only an adviser or subject teacher account can advise a section or teach a class.' };
  }
  const { sectionId, offeringIds } = requested;
  if ((sectionId !== null && !Number.isInteger(sectionId)) || offeringIds.some((id) => !Number.isInteger(id))) {
    return { ok: false, status: 400, error: 'The section or class chosen is not valid.' };
  }

  let section = null;
  if (sectionId !== null) {
    const result = await pool.query(
      `SELECT sec.id, sec.name, sec.grade_level, sec.adviser_id, u.full_name AS adviser_name
       FROM sections sec
       JOIN school_years sy ON sy.id = sec.school_year_id
       LEFT JOIN users u ON u.id = sec.adviser_id
       WHERE sec.id = $1 AND sec.is_active = TRUE AND sy.is_current = TRUE`,
      [sectionId]
    );
    section = result.rows[0];
    if (!section) {
      return { ok: false, status: 400, error: 'That section is not an active section of the current school year.' };
    }
  }

  let offerings = [];
  if (offeringIds.length > 0) {
    const result = await pool.query(
      `SELECT co.id, co.teacher_id, subj.name AS subject_name, sec.name AS section_name, u.full_name AS teacher_name
       FROM class_offerings co
       JOIN subjects subj ON subj.id = co.subject_id
       JOIN sections sec ON sec.id = co.section_id
       JOIN school_years sy ON sy.id = co.school_year_id
       LEFT JOIN users u ON u.id = co.teacher_id
       WHERE co.id = ANY($1::int[]) AND co.is_active = TRUE AND sy.is_current = TRUE`,
      [offeringIds]
    );
    offerings = result.rows;
    if (offerings.length !== offeringIds.length) {
      return { ok: false, status: 400, error: 'One of the classes chosen is not an active class of the current school year.' };
    }
  }

  return { ok: true, section, offerings };
}

// Writes the links inside the caller's transaction. Returns what moved and
// from whom, so the form can say "STEM A moved from Robles to you".
async function applyAssignments(client, userId, { section, offerings }) {
  const linked = { section: null, offerings: [] };
  if (section) {
    await client.query('UPDATE sections SET adviser_id = $1 WHERE id = $2', [userId, section.id]);
    linked.section = {
      id: section.id,
      name: section.name,
      gradeLevel: section.grade_level,
      previousAdviser: section.adviser_id && section.adviser_id !== userId ? section.adviser_name : null,
    };
  }
  for (const offering of offerings) {
    await client.query('UPDATE class_offerings SET teacher_id = $1 WHERE id = $2', [userId, offering.id]);
    linked.offerings.push({
      id: offering.id,
      subjectName: offering.subject_name,
      sectionName: offering.section_name,
      previousTeacher: offering.teacher_id && offering.teacher_id !== userId ? offering.teacher_name : null,
    });
  }
  return linked;
}

// What the admin's pickers offer: every active section and class of the
// current school year, each with whoever holds it now.
async function listAssignableTargets() {
  const sections = await pool.query(
    `SELECT sec.id, sec.name, sec.grade_level, sec.adviser_id, u.full_name AS adviser_name
     FROM sections sec
     JOIN school_years sy ON sy.id = sec.school_year_id
     LEFT JOIN users u ON u.id = sec.adviser_id
     WHERE sec.is_active = TRUE AND sy.is_current = TRUE
     ORDER BY sec.grade_level, sec.name`
  );
  const offerings = await pool.query(
    `SELECT co.id, co.term, co.teacher_id, subj.name AS subject_name, sec.name AS section_name,
            sec.grade_level, u.full_name AS teacher_name
     FROM class_offerings co
     JOIN subjects subj ON subj.id = co.subject_id
     JOIN sections sec ON sec.id = co.section_id
     JOIN school_years sy ON sy.id = co.school_year_id
     LEFT JOIN users u ON u.id = co.teacher_id
     WHERE co.is_active = TRUE AND sy.is_current = TRUE
     ORDER BY sec.grade_level, sec.name, subj.name`
  );
  return { sections: sections.rows, classOfferings: offerings.rows };
}

module.exports = { ASSIGNABLE_ROLES, readRequestedAssignments, validateAssignments, applyAssignments, listAssignableTargets };
