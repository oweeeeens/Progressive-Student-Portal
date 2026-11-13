import { useEffect, useState } from 'react'
import { IdCard, School, Phone, BookOpen, MessageCircle } from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Alert } from '../components/Alert'
import { SkeletonTable } from '../components/Skeleton'
import { DataTable, fieldValue } from '../components/table/DataTable'
import { useOwnStudentRecord } from '../hooks/useOwnStudentRecord'
import { humanize } from '../utils/humanize'
import { CLASS_TERM_SHORT, SUBJECT_CATEGORY_LABELS } from '../utils/academicTerms'
import './StudentRecordPage.css'

// My Record — the learner's own student record, read-only.
//
// A learner has a right to see the personal data the school holds about them
// (Data Privacy Act of 2012, RA 10173, Sec. 16), and they are the person most
// likely to notice a wrong birth date, LRN or guardian number before it
// reaches the school's reports. This was a disclosure at the very bottom of
// the student Home page, where almost nobody found it; it now has its own
// page in the student sidebar.
//
// Read-only by design: corrections go through the registrar, who owns the
// record. The PWD / 4Ps / ALS learner-status flags never appear — the server
// strips them for a student before the record is sent
// (backend config/learnerStatus.js), so there is nothing to hide here.
//
// Data: the caller's own record (useOwnStudentRecord, scoped server-side)
// and their section's classes this school year (GET /students/:id/subjects,
// scoped by the same lookup — any other id answers 404).

function formatDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'long' })
}

function Field({ label, children }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function RecordCard({ icon: Icon, title, children }) {
  return (
    <section className="rec-card" aria-label={title}>
      <h2>
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        {title}
      </h2>
      <dl className="field-grid rec-card__fields">{children}</dl>
    </section>
  )
}

export function StudentRecordPage() {
  const { student, loading, error } = useOwnStudentRecord()
  const [subjects, setSubjects] = useState(null)
  const [subjectsError, setSubjectsError] = useState(null)

  useEffect(() => {
    if (!student) return
    api
      .get(`/students/${student.id}/subjects`)
      .then((data) => setSubjects(data.subjects))
      .catch((err) => {
        setSubjectsError(err.message)
        setSubjects([])
      })
  }, [student])

  if (loading) return <SkeletonTable rows={6} columns={2} />
  if (error) return <Alert>{error}</Alert>
  if (!student) {
    return (
      <div className="empty-state">
        <p>No student record is linked to this account.</p>
        <p>Ask the registrar to connect your login to your student record.</p>
      </div>
    )
  }

  const fullName = [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ')

  return (
    <div className="student-record">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Record' }]} />
      <div className="page-header">
        <h1>My Record</h1>
      </div>
      <p className="help-text mb-3">
        This is the record the school keeps about you. You can view it here; only the school can change it.
      </p>

      <div className="rec-grid">
        <RecordCard icon={IdCard} title="Who you are">
          <Field label="Full name">{fullName}</Field>
          <Field label="LRN">{fieldValue(student.lrn)}</Field>
          <Field label="Date of birth">{formatDate(student.date_of_birth)}</Field>
          <Field label="Sex">{fieldValue({ M: 'Male', F: 'Female' }[student.sex] || student.sex)}</Field>
        </RecordCard>

        <RecordCard icon={School} title="Your enrollment">
          <Field label="Grade and section">
            {student.section_name ? `Grade ${student.grade_level} – ${student.section_name}` : fieldValue(null)}
          </Field>
          <Field label="Strand">{fieldValue(student.strand)}</Field>
          <Field label="Adviser">{fieldValue(student.adviser_name)}</Field>
          <Field label="Enrollment status">{fieldValue(humanize(student.enrollment_status))}</Field>
        </RecordCard>

        <RecordCard icon={Phone} title="Contact details">
          <Field label="Personal email">{fieldValue(student.email)}</Field>
          <Field label="Address">{fieldValue(student.address)}</Field>
          <Field label="Guardian">{fieldValue(student.guardian_name)}</Field>
          <Field label="Guardian contact number">{fieldValue(student.guardian_contact_number)}</Field>
        </RecordCard>
      </div>

      <div className="record-section">
        <h2 className="rec-section-title">
          <BookOpen size={18} strokeWidth={1.75} aria-hidden="true" />
          Your classes this school year
        </h2>
        {subjectsError && <Alert>Couldn&apos;t load your classes: {subjectsError}</Alert>}
        {subjects === null ? (
          <SkeletonTable rows={5} columns={3} />
        ) : (
          <DataTable
            columns={[
              { key: 'subject', header: 'Subject', primary: true, plainText: (s) => s.subject_name, render: (s) => <span className="cell-primary">{s.subject_name}</span> },
              { key: 'type', header: 'Type', render: (s) => SUBJECT_CATEGORY_LABELS[s.subject_category] || humanize(s.subject_category) },
              { key: 'teacher', header: 'Teacher', render: (s) => fieldValue(s.teacher_name) },
              // Specialized subjects run all year whatever the class says
              // (utils/academicTerms.js), so say so rather than a term.
              { key: 'runs', header: 'Runs', render: (s) => (s.subject_category === 'specialized' ? 'Whole year' : CLASS_TERM_SHORT[s.term] || 'Whole year') },
            ]}
            rows={subjects}
            rowKey={(s) => s.id}
            emptyState={
              <>
                <p>No classes listed for you yet.</p>
                <p>Your classes appear here once your section has its subjects for this school year.</p>
              </>
            }
          />
        )}
      </div>

      <aside className="rec-correct" aria-label="Correcting your record">
        <MessageCircle size={18} strokeWidth={1.75} aria-hidden="true" />
        <div>
          <h2>Is something wrong?</h2>
          <p>
            Tell the registrar, or your adviser{student.adviser_name ? ` (${student.adviser_name})` : ''}, who can pass it on.
            Your LRN, name and date of birth must match your DepEd records and your birth certificate, so bring a copy if
            one of those is wrong.
          </p>
        </div>
      </aside>
    </div>
  )
}
