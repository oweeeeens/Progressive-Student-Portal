import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Pencil, MessageCircle } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { SkeletonTable } from '../components/Skeleton'
import { fieldValue } from '../components/table/DataTable'
import { useOwnStudentRecord } from '../hooks/useOwnStudentRecord'
import { humanize } from '../utils/humanize'
import { CLASS_TERM_SHORT, SUBJECT_CATEGORY_LABELS } from '../utils/academicTerms'
// The "Is something wrong?" note reuses My Record's styles.
import './StudentRecordPage.css'
import './StudentRegistrationPage.css'

// The Student Registration Form — the panel's item 2, an in-system page (not
// a printable): the learner's name, LRN, grade level, section, strand,
// school year, adviser, and the subjects they are enrolled in with each
// teacher.
//
//   /students/:id/registration  the registrar and admin. "Edit details"
//                               opens the existing student form, which
//                               returns here after saving — one edit form
//                               in the system, so its rules cannot drift.
//   /my-registration            the learner's own copy, read-only.
//
// Data: GET /students/:id/registration (studentController.getRegistration),
// which decides who may open it; the subject list is the learner's
// enrollments (class_enrollments), not a guess from the section.

const TERM_LABEL = (s) => (s.subject_category === 'specialized' ? 'Whole year' : CLASS_TERM_SHORT[s.term] || 'Whole year')

function formatDate(iso) {
  if (!iso) return null
  const [y, m, d] = String(iso).split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'long' })
}

// One labelled value on the form.
function Entry({ label, children, wide = false }) {
  return (
    <div className={`reg-form__entry${wide ? ' reg-form__entry--wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function RegistrationForm({ studentId, isOwnCopy }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api
      .get(`/students/${studentId}/registration`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  const reg = data?.registration
  const fullName = reg ? [reg.last_name, [reg.first_name, reg.middle_name].filter(Boolean).join(' ')].join(', ') : ''

  const crumbs = isOwnCopy
    ? [{ label: 'Home', to: '/' }, { label: 'Registration Form' }]
    : [
        { label: 'Home', to: '/' },
        { label: 'Students', to: '/students' },
        { label: reg ? `${reg.last_name}, ${reg.first_name}` : 'Student', to: `/students/${studentId}` },
        { label: 'Registration Form' },
      ]

  return (
    <div className="registration-page">
      <Breadcrumbs items={crumbs} />
      <div className="page-header">
        <h1>Registration Form</h1>
        {data?.canEdit && (
          <div className="page-header__actions">
            <button type="button" className="btn-primary" onClick={() => navigate(`/students/${studentId}/edit?returnTo=registration`)}>
              <Pencil size={16} strokeWidth={1.75} /> Edit details
            </button>
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {!error && !reg && <SkeletonTable rows={8} columns={2} />}

      {reg && (
        <article className="reg-form" aria-label={`Registration form of ${fullName}`}>
          <header className="reg-form__head">
            <img src="/logo.png" alt="" className="reg-form__logo" />
            <div>
              <p className="reg-form__school">DepEd Progressive Senior High School — Bacoor City</p>
              <h2 className="reg-form__title">Student Registration Form</h2>
              <p className="reg-form__year">School Year {fieldValue(reg.school_year)}</p>
            </div>
          </header>

          <section className="reg-form__part" aria-labelledby="reg-learner">
            <h3 id="reg-learner">Learner information</h3>
            <dl className="reg-form__grid">
              <Entry label="Name (Last, First Middle)" wide>
                <strong>{fullName}</strong>
              </Entry>
              <Entry label="LRN">{fieldValue(reg.lrn)}</Entry>
              <Entry label="Sex">{fieldValue({ M: 'Male', F: 'Female' }[reg.sex] || reg.sex)}</Entry>
              <Entry label="Date of birth">{fieldValue(formatDate(reg.date_of_birth))}</Entry>
              <Entry label="Personal email">{fieldValue(reg.email)}</Entry>
              <Entry label="Address" wide>
                {fieldValue(reg.address)}
              </Entry>
            </dl>
          </section>

          <section className="reg-form__part" aria-labelledby="reg-enrollment">
            <h3 id="reg-enrollment">Enrollment</h3>
            <dl className="reg-form__grid">
              <Entry label="School year">{fieldValue(reg.school_year)}</Entry>
              <Entry label="Grade level">{reg.grade_level ? `Grade ${reg.grade_level}` : fieldValue(null)}</Entry>
              <Entry label="Section">{fieldValue(reg.section_name)}</Entry>
              <Entry label="Strand">{fieldValue(reg.strand)}</Entry>
              <Entry label="Adviser">{fieldValue(reg.adviser_name)}</Entry>
              <Entry label="Enrollment status">{fieldValue(humanize(reg.enrollment_status))}</Entry>
            </dl>
          </section>

          <section className="reg-form__part" aria-labelledby="reg-guardian">
            <h3 id="reg-guardian">Parent / guardian</h3>
            <dl className="reg-form__grid">
              <Entry label="Name">{fieldValue(reg.guardian_name)}</Entry>
              <Entry label="Contact number">{fieldValue(reg.guardian_contact_number)}</Entry>
            </dl>
          </section>

          <section className="reg-form__part" aria-labelledby="reg-subjects">
            <h3 id="reg-subjects">Enrolled subjects</h3>
            {reg.subjects.length === 0 ? (
              <p className="help-text">
                {reg.section_name
                  ? 'No subjects yet. Subjects appear as soon as classes are set up for this section.'
                  : 'Not in a section yet, so not enrolled in any subject.'}
              </p>
            ) : (
              <div className="table-card">
                <table className="reg-form__subjects">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Subject</th>
                      <th scope="col">Type</th>
                      <th scope="col">Teacher</th>
                      <th scope="col">Runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.subjects.map((s, i) => (
                      <tr key={s.id}>
                        <td>{i + 1}</td>
                        <td>
                          <span className="cell-primary">{s.subject_name}</span>
                          {s.subject_code && <span className="reg-form__code">{s.subject_code}</span>}
                        </td>
                        <td>{SUBJECT_CATEGORY_LABELS[s.subject_category] || humanize(s.subject_category)}</td>
                        <td>{fieldValue(s.teacher_name)}</td>
                        <td>{TERM_LABEL(s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="reg-form__count">
              {reg.subjects.length} subject{reg.subjects.length === 1 ? '' : 's'}
            </p>
          </section>
        </article>
      )}

      {reg && isOwnCopy && (
        <aside className="rec-correct mt-4" aria-label="Correcting your registration">
          <MessageCircle size={18} strokeWidth={1.75} aria-hidden="true" />
          <div>
            <h2>Is something wrong?</h2>
            <p>
              This form is read-only. Tell the registrar, or your adviser{reg.adviser_name ? ` (${reg.adviser_name})` : ''}, and they will
              correct it.
            </p>
          </div>
        </aside>
      )}
    </div>
  )
}

// /students/:id/registration — the registrar's and admin's view.
export function StudentRegistrationPage() {
  const { id } = useParams()
  return <RegistrationForm studentId={id} isOwnCopy={false} />
}

// /my-registration — the learner's own copy.
export function MyRegistrationPage() {
  const { student, loading, error } = useOwnStudentRecord()
  if (loading) return <SkeletonTable rows={8} columns={2} />
  if (error) return <Alert>{error}</Alert>
  if (!student) {
    return (
      <div className="empty-state">
        <p>No student record is linked to this account.</p>
        <p>Ask the registrar to connect your login to your student record.</p>
      </div>
    )
  }
  return <RegistrationForm studentId={student.id} isOwnCopy />
}
