// Analytics' "Learner Outlook": who is at risk of failing, in what, and why.
// Pure functions over rows the model already fetched — no database here —
// so each view can be tested on its own (scripts/testOutlookCalculator.js).
// Every threshold comes from config/outlookConfig.js, which cites the
// DepEd Order No. 015, s. 2026 paragraph it implements.
const {
  PASSING_GRADE,
  PROMOTION_FAIL_LIMIT,
  ABSENCE_ALERT_DAYS,
  ABSENCE_APPROACHING_DAYS,
  COMPONENT_STRUGGLE_PERCENT,
} = require('../config/outlookConfig');

const round1 = (v) => Math.round(v * 10) / 10;
const fullName = (r) => `${r.last_name}, ${r.first_name}`;

// Each learner's grade per subject SO FAR this year: the average of the
// subject's finalized term grades, rounded to a whole number the way DepEd
// rounds a final grade. With all terms in, this IS the final grade.
//
// rows: finalized grade rows { student_id, first_name, last_name,
//   current_section_id, section_name, grade_level, strand,
//   class_offering_id, subject_name, grade_value }
function subjectGradesSoFar(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.student_id}|${r.class_offering_id}`;
    if (!byKey.has(key)) byKey.set(key, { ...r, grades: [] });
    byKey.get(key).grades.push(Number(r.grade_value));
  }
  return [...byKey.values()].map((e) => ({
    studentId: e.student_id,
    name: fullName(e),
    sectionId: e.current_section_id,
    sectionName: e.section_name,
    gradeLevel: e.grade_level,
    classOfferingId: e.class_offering_id,
    subjectName: e.subject_name,
    termsCounted: e.grades.length,
    grade: Math.round(e.grades.reduce((s, g) => s + g, 0) / e.grades.length),
  }));
}

// ¶67: on track (no subject below 75), summer remedial (1–2 below), or
// retention risk (3 or more below). Only learners with at least one
// finalized grade are classified — a learner with no grades yet has no
// outlook, not a good one.
function promotionOutlook(gradeRows) {
  const perSubject = subjectGradesSoFar(gradeRows);
  const byStudent = new Map();
  for (const s of perSubject) {
    if (!byStudent.has(s.studentId)) {
      byStudent.set(s.studentId, { studentId: s.studentId, name: s.name, sectionName: s.sectionName, gradeLevel: s.gradeLevel, subjects: 0, failing: [] });
    }
    const learner = byStudent.get(s.studentId);
    learner.subjects += 1;
    if (s.grade < PASSING_GRADE) learner.failing.push({ subjectName: s.subjectName, grade: s.grade });
  }
  const learners = [...byStudent.values()].map((l) => ({
    ...l,
    category: l.failing.length === 0 ? 'on_track' : l.failing.length <= PROMOTION_FAIL_LIMIT ? 'summer_remedial' : 'retention_risk',
  }));
  const counts = { on_track: 0, summer_remedial: 0, retention_risk: 0 };
  for (const l of learners) counts[l.category] += 1;
  const order = { retention_risk: 0, summer_remedial: 1, on_track: 2 };
  learners.sort((a, b) => order[a.category] - order[b.category] || b.failing.length - a.failing.length || a.name.localeCompare(b.name));
  return { counts, total: learners.length, learners };
}

// Which subjects drive the failing: per subject (and section), how many
// learners are below 75 so far, the average grade and the share failing.
// Worst first, so the first rows are where to look.
function subjectsCausingFailure(gradeRows) {
  const groups = new Map();
  for (const s of subjectGradesSoFar(gradeRows)) {
    const key = s.classOfferingId;
    if (!groups.has(key)) {
      groups.set(key, { classOfferingId: key, subjectName: s.subjectName, sectionName: s.sectionName, gradeLevel: s.gradeLevel, learners: 0, failing: 0, sum: 0 });
    }
    const g = groups.get(key);
    g.learners += 1;
    g.sum += s.grade;
    if (s.grade < PASSING_GRADE) g.failing += 1;
  }
  return [...groups.values()]
    .map(({ sum, ...g }) => ({ ...g, average: round1(sum / g.learners), failingShare: round1((g.failing / g.learners) * 100) }))
    .sort((a, b) => b.failing - a.failing || b.failingShare - a.failingShare || a.average - b.average);
}

// Where learners lose points (¶68): per class, the average percentage in
// each component across learners with a complete component, and how many
// are below COMPONENT_STRUGGLE_PERCENT in it.
//
// computations: [{ classOfferingId, subjectName, sectionName, computed }]
// where `computed` is gradeCalculator.computeTermGrade output.
function componentProfile(computations) {
  const groups = new Map();
  for (const c of computations) {
    if (!groups.has(c.classOfferingId)) {
      groups.set(c.classOfferingId, { classOfferingId: c.classOfferingId, subjectName: c.subjectName, sectionName: c.sectionName, components: {} });
    }
    const g = groups.get(c.classOfferingId);
    for (const comp of c.computed.components) {
      if (comp.percentageScore === null) continue;
      if (!g.components[comp.key]) g.components[comp.key] = { key: comp.key, label: comp.label, weight: comp.weight, sum: 0, count: 0, struggling: 0 };
      const agg = g.components[comp.key];
      agg.sum += comp.percentageScore;
      agg.count += 1;
      if (comp.percentageScore < COMPONENT_STRUGGLE_PERCENT) agg.struggling += 1;
    }
  }
  return [...groups.values()]
    .map((g) => {
      const components = Object.values(g.components).map(({ sum, ...a }) => ({ ...a, average: round1(sum / a.count) }));
      const weakest = components.reduce((w, c) => (w === null || c.average < w.average ? c : w), null);
      return { ...g, components, weakest: weakest ? weakest.key : null, weakestAverage: weakest ? weakest.average : null };
    })
    .filter((g) => g.components.length > 0)
    .sort((a, b) => a.weakestAverage - b.weakestAverage);
}

// Early warning before grades are final (¶68): from the class record as it
// stands, learners whose PROVISIONAL term grade is below 75, and learners
// with scores still missing. Provisional on purpose — this never feeds the
// official risk score, which reads finalized grades only (CLAUDE.md).
function earlyWarning(computations) {
  const belowPassing = [];
  const missingWork = [];
  for (const c of computations) {
    const base = { studentId: c.studentId, name: c.name, sectionName: c.sectionName, subjectName: c.subjectName, classOfferingId: c.classOfferingId };
    if (c.computed.complete && c.computed.termGrade < PASSING_GRADE) {
      belowPassing.push({ ...base, provisionalGrade: c.computed.termGrade, initialGrade: c.computed.initialGrade });
    }
    const missing = c.computed.missing.filter((m) => m.startsWith('No score for'));
    if (missing.length > 0) missingWork.push({ ...base, missingCount: missing.length, missing: missing.map((m) => m.replace('No score for ', '')) });
  }
  belowPassing.sort((a, b) => a.provisionalGrade - b.provisionalGrade || a.name.localeCompare(b.name));
  missingWork.sort((a, b) => b.missingCount - a.missingCount || a.name.localeCompare(b.name));
  return {
    belowPassing,
    missingWork,
    learnersBelowPassing: new Set(belowPassing.map((r) => r.studentId)).size,
    learnersMissingWork: new Set(missingWork.map((r) => r.studentId)).size,
  };
}

// ¶70: learners at or past twelve absences this school year, and those
// approaching it.
// rows: { student_id, first_name, last_name, section_name, absent, excused, recorded_days }
function absenceAlert(rows) {
  const learners = rows
    .map((r) => {
      const absences = Number(r.absent) + Number(r.excused);
      const days = Number(r.recorded_days);
      return {
        studentId: r.student_id,
        name: fullName(r),
        sectionName: r.section_name,
        absent: Number(r.absent),
        excused: Number(r.excused),
        absences,
        recordedDays: days,
        attendanceRate: days > 0 ? round1(((days - absences) / days) * 100) : null,
        level: absences >= ABSENCE_ALERT_DAYS ? 'alert' : absences >= ABSENCE_APPROACHING_DAYS ? 'approaching' : null,
      };
    })
    .filter((l) => l.level !== null)
    .sort((a, b) => b.absences - a.absences || a.name.localeCompare(b.name));
  return {
    alert: learners.filter((l) => l.level === 'alert').length,
    approaching: learners.filter((l) => l.level === 'approaching').length,
    learners,
  };
}

module.exports = { subjectGradesSoFar, promotionOutlook, subjectsCausingFailure, componentProfile, earlyWarning, absenceAlert };
