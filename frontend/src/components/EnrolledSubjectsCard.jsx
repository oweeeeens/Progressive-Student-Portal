import { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { api } from '../api/client'
import { Alert } from './Alert'
import { Skeleton } from './Skeleton'
import { CLASS_TERM_SHORT } from '../utils/academicTerms'

// "Your subjects" on the student Home — the classes the learner is ENROLLED
// in this school year (class_enrollments, via GET /students/:id/subjects),
// each with its teacher and when it runs. The panel asked for the learner's
// enrolled subjects to be on their Home page, drawn from the enrollment data.
//
// Its own request and its own states, so a failure says so rather than
// looking like "you have no subjects".
const runs = (s) => (s.subject_category === 'specialized' ? 'Whole year' : CLASS_TERM_SHORT[s.term] || 'Whole year')

export function EnrolledSubjectsCard({ studentId }) {
  const [subjects, setSubjects] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api
      .get(`/students/${studentId}/subjects`)
      .then((data) => {
        if (!cancelled) setSubjects(data.subjects)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  return (
    <section className="panel enrolled-subjects" aria-labelledby="enrolled-subjects-title">
      <h2 id="enrolled-subjects-title">
        <BookOpen size={18} strokeWidth={1.75} aria-hidden="true" />
        Your subjects
        {subjects && <span className="enrolled-subjects__count">{subjects.length}</span>}
      </h2>
      {error && <Alert>Couldn&apos;t load your subjects: {error}</Alert>}
      {!error && subjects === null && (
        <div aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h="2.25rem" className="mb-2" />
          ))}
        </div>
      )}
      {subjects && subjects.length === 0 && (
        <p className="help-text">You are not enrolled in any subject yet. Your subjects appear once your section has its classes.</p>
      )}
      {subjects && subjects.length > 0 && (
        <ul className="enrolled-subjects__list">
          {subjects.map((s) => (
            <li key={s.id}>
              <span className="enrolled-subjects__name">{s.subject_name}</span>
              <span className="enrolled-subjects__meta">
                {s.teacher_name || 'Teacher to be assigned'} · {runs(s)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
