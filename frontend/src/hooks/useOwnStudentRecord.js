import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Resolves "this student's own record" for the pages a student has of their
// own (home, grades, attendance). There is no :id in the URL anywhere in
// the student experience, so each of those pages would otherwise repeat the
// same two-step lookup: list the students this account can see — which
// studentModel self-scopes to exactly one row for a student — then fetch
// that row's detail endpoint, which is the only one that joins the adviser's
// name.
//
// Returns the full record, not just an id, because every caller needs both:
// the id for the report-card download and the attendance endpoints, the
// record for the namecard. Learner-status fields (PWD / 4Ps / ALS) never
// arrive here — the server strips them for the student role before the
// response leaves studentController.
export function useOwnStudentRecord() {
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    api
      .get('/students?pageSize=1')
      .then((data) => {
        const own = data.students[0]
        // No record linked to this login yet. Not an error — the registrar
        // simply hasn't connected the account — so it resolves to null and
        // each page shows its own empty state.
        if (!own) return null
        return api.get(`/students/${own.id}`).then((full) => full.student)
      })
      .then((record) => {
        if (!cancelled) setStudent(record)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { student, loading, error }
}
