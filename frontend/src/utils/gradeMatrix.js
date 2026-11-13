// One student's grades, reshaped into one row per subject with one cell per
// grading period — the shape every grade view in the System reads from.
//
// It used to be built inside StudentGradesPage only, while the staff view of
// the same learner (GradeHistory) printed the raw rows: Term 2 and Term 1
// interleaved in one table. Both now build their rows here, so a staff member
// and the learner themselves see the same marks grouped the same way.

// How official a grade record is, used to pick ONE value per subject/period
// cell when a period holds several (a rejected submission and the entry that
// replaced it). Higher wins.
export const GRADE_STATUS_RANK = { rejected: 0, submitted: 1, principal_verified: 2, finalized: 3 }

// Only a finalized mark is the official record (CLAUDE.md's approval
// workflow), so anything earlier in the pipeline is labelled rather than
// printed as if it were final. Shown under the mark on the student's view.
// The four statuses a grade can hold, as the approval chain defines them:
// submitted → principal_verified → finalized, plus rejected. The colours are
// the non-risk status palette, never the risk ramp — a grade awaiting
// verification is not an at-risk student (see CLAUDE.md). Shared by the
// staff term tables and the learner's My Grades so the two never word or
// colour a status differently.
export const GRADE_STATUS_VARIANTS = {
  submitted: 'info',
  principal_verified: 'warning',
  finalized: 'positive',
  rejected: 'negative',
}

// The stored values carry underscores; a reader should not have to.
export const GRADE_STATUS_LABELS = {
  submitted: 'Submitted',
  principal_verified: 'Verified by principal',
  finalized: 'Finalized',
  rejected: 'Returned to teacher',
}

export const GRADE_STATUS_NOTES = {
  submitted: 'In review',
  principal_verified: 'In review',
  rejected: 'Returned to teacher',
}

// `grades`  — rows from GET /students/:id/grades (one per grade record).
// `subjects` — optional class list from GET /my-progress/subjects. When
//              given, rows start from it so a subject with no mark yet still
//              appears; staff have no such list, so their rows come from the
//              grades alone.
//
// Cells are keyed on `grading_period_id`, not the period's name: the name is
// free text the school sets and can repeat across school years, the id
// cannot.
//
// Rows are keyed on `subject_id`, not the name — only `code` is unique, so a
// Grade 11 and a Grade 12 subject sharing a name would otherwise merge.
export function buildGradeMatrix({ grades, subjects }) {
  const rows = new Map()

  for (const s of subjects || []) {
    rows.set(s.subjectId, {
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      teacherName: s.teacherName,
      // How long this class runs and what kind of subject it is: together
      // these decide which terms it belongs in (utils/academicTerms.js).
      term: s.term,
      category: s.category,
      cells: {},
    })
  }

  for (const g of grades || []) {
    if (!rows.has(g.subject_id)) {
      rows.set(g.subject_id, {
        subjectId: g.subject_id,
        subjectName: g.subject_name,
        teacherName: null,
        term: g.term,
        category: g.subject_category,
        cells: {},
      })
    }
    const row = rows.get(g.subject_id)
    const existing = row.cells[g.grading_period_id]
    if (!existing || GRADE_STATUS_RANK[g.status] > GRADE_STATUS_RANK[existing.status]) {
      row.cells[g.grading_period_id] = { value: Number(g.grade_value), status: g.status, computation: g.computation || null }
    }
  }

  return [...rows.values()]
    .map((row) => {
      // Finalized marks only — the same official-record rule the risk formula
      // uses, so this average and the one on the home page never disagree.
      const finalized = Object.values(row.cells).filter((c) => c.status === 'finalized')
      const average = finalized.length
        ? Math.round((finalized.reduce((sum, c) => sum + c.value, 0) / finalized.length) * 10) / 10
        : null
      return { ...row, average }
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName))
}

// The average of one period's FINALIZED marks across the given rows, or null
// when none are finalized yet. Rounded to one decimal, like every average
// the System shows.
export function finalizedAverageForPeriod(rows, periodId) {
  const marks = rows.map((r) => r.cells[periodId]).filter((c) => c?.status === 'finalized')
  if (marks.length === 0) return null
  return Math.round((marks.reduce((sum, c) => sum + c.value, 0) / marks.length) * 10) / 10
}
