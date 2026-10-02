import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  IdCard,
  User,
  UserRound,
  Calendar,
  MapPin,
  Mail,
  Users,
  Phone,
  School,
  ClipboardCheck,
  Check,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { api } from '../api/client'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusPill } from '../components/StatusPill'
import './StudentFormPage.css'

const EMPTY_FORM = {
  lrn: '',
  firstName: '',
  middleName: '',
  lastName: '',
  sex: '',
  dateOfBirth: '',
  address: '',
  email: '',
  guardianName: '',
  guardianContactNumber: '',
  currentSectionId: '',
  enrollmentStatus: 'pending',
}

// snake_case (API response) -> camelCase (form state), for edit mode.
function toFormState(student) {
  return {
    lrn: student.lrn,
    firstName: student.first_name,
    middleName: student.middle_name || '',
    lastName: student.last_name,
    sex: student.sex || '',
    dateOfBirth: student.date_of_birth?.slice(0, 10) || '',
    address: student.address || '',
    email: student.email || '',
    guardianName: student.guardian_name || '',
    guardianContactNumber: student.guardian_contact_number || '',
    currentSectionId: student.current_section_id || '',
    enrollmentStatus: student.enrollment_status,
  }
}

const LRN_PATTERN = /^\d{12}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STATUS_VARIANTS = { enrolled: 'positive', pending: 'warning', dropped: 'negative', transferred: 'neutral', graduated: 'info' }

// Mirrors backend/controllers/studentController.js's validateStudentInput
// exactly, so inline feedback here can never promise something the server
// then rejects. Fields with no case here (middleName, address, guardian
// fields, section) have no format rule — they just don't get a validator.
function validateField(field, value) {
  switch (field) {
    case 'lrn':
      if (!value) return 'LRN is required.'
      return LRN_PATTERN.test(value) ? null : 'Must be exactly 12 digits.'
    case 'firstName':
      return value.trim() ? null : 'First name is required.'
    case 'lastName':
      return value.trim() ? null : 'Last name is required.'
    case 'dateOfBirth': {
      if (!value) return 'Date of birth is required.'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return 'Enter a valid date.'
      return date > new Date() ? 'Cannot be in the future.' : null
    }
    case 'email':
      if (!value) return null
      return EMAIL_PATTERN.test(value) ? null : 'Enter a valid email address.'
    default:
      return null
  }
}

const STEPS = [
  { key: 'basic', label: 'Basic Information', fields: ['lrn', 'firstName', 'lastName', 'dateOfBirth'] },
  { key: 'contact', label: 'Contact & Address', fields: [] },
  { key: 'review', label: 'Review & Submit', fields: [] },
]

function FormField({ id, icon: Icon, label, required, error, showSuccess, children }) {
  return (
    <div className="form-field">
      <label htmlFor={id} className="form-field__label">
        <Icon size={16} strokeWidth={1.75} />
        {label}
        {required && <span className="required-mark"> *</span>}
      </label>
      {children}
      {error && (
        <p className="form-field__feedback form-field__feedback--error">
          <CircleAlert size={14} strokeWidth={1.75} /> {error}
        </p>
      )}
      {!error && showSuccess && (
        <p className="form-field__feedback form-field__feedback--success">
          <Check size={14} strokeWidth={1.75} /> Looks good
        </p>
      )}
    </div>
  )
}

export function StudentFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [form, setForm] = useState(EMPTY_FORM)
  const [sections, setSections] = useState([])
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [provisioned, setProvisioned] = useState(null) // { email, tempPassword } | null
  const [savedStudentId, setSavedStudentId] = useState(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [touched, setTouched] = useState({})

  useEffect(() => {
    api.get('/sections').then((data) => setSections(data.sections))
  }, [])

  useEffect(() => {
    if (isEdit) {
      api.get(`/students/${id}`).then((data) => setForm(toFormState(data.student)))
    }
  }, [id, isEdit])

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function markTouched(field) {
    setTouched((t) => ({ ...t, [field]: true }))
  }

  function handleNext() {
    const stepFields = STEPS[currentStep].fields
    const hasErrors = stepFields.some((f) => validateField(f, form[f]))
    if (hasErrors) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(stepFields.map((f) => [f, true])) }))
      return
    }
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 0))
  }

  // Enter in a text field advances to the next step instead of submitting
  // the whole multi-step form early — only the last step's button should
  // actually submit.
  function handleFormKeyDown(e) {
    if (e.key === 'Enter' && currentStep < STEPS.length - 1) {
      e.preventDefault()
      handleNext()
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    // The authoritative check, across every validated field regardless of
    // which step is currently showing — the per-step gate on "Next" is a
    // convenience, not the real guard.
    const invalidFields = Object.keys(EMPTY_FORM).filter((f) => validateField(f, form[f]))
    if (invalidFields.length > 0) {
      setTouched((t) => ({ ...t, ...Object.fromEntries(invalidFields.map((f) => [f, true])) }))
      setError('Please fix the highlighted fields before submitting.')
      setCurrentStep(invalidFields.some((f) => STEPS[0].fields.includes(f)) ? 0 : 1)
      return
    }

    setSubmitting(true)
    const payload = {
      ...form,
      currentSectionId: form.currentSectionId ? Number(form.currentSectionId) : null,
      sex: form.sex || null,
    }

    try {
      const data = isEdit
        ? await api.patch(`/students/${id}`, payload)
        : await api.post('/students', payload)

      // If this save is what triggered their portal account (enrollment
      // just reached 'enrolled' with an email on file), show the one-time
      // temp password here instead of navigating straight away — it can't
      // be retrieved again after this.
      if (data.accountProvisioned) {
        setProvisioned(data.accountProvisioned)
        setSavedStudentId(data.student.id)
      } else {
        navigate(`/students/${data.student.id}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (provisioned) {
    return (
      <div style={{ maxWidth: 480 }}>
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Students', to: '/students' }, { label: 'New' }]} />
        <h1>Student Account Created</h1>
        <div className="alert alert--success">
          <p>
            A portal account was created for <strong>{provisioned.email}</strong>.
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Share this temporary password with the student now — it will not be shown again.
            They'll be required to change it on first login.
          </p>
          <code className="alert__code">{provisioned.tempPassword}</code>
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate(`/students/${savedStudentId}`)}>
          Continue to Student Profile
        </button>
      </div>
    )
  }

  const selectedSection = sections.find((s) => String(s.id) === String(form.currentSectionId))
  const sectionLabel = selectedSection ? `Grade ${selectedSection.grade_level} - ${selectedSection.name}` : null
  const fullName = `${form.firstName} ${form.lastName}`.trim()
  const initials = `${form.firstName[0] || ''}${form.lastName[0] || ''}`.toUpperCase()

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: 'Students', to: '/students' },
          { label: isEdit ? 'Edit' : 'New' },
        ]}
      />
      <h1>{isEdit ? 'Edit Student' : 'New Student'}</h1>

      <div className="student-form-layout">
        <div>
          <ol className="form-steps">
            {STEPS.map((step, index) => (
              <li className="form-steps__item" key={step.key}>
                {index > 0 && <span className={`form-steps__connector${index <= currentStep ? ' is-done' : ''}`} />}
                <button
                  type="button"
                  className={`form-steps__step${index === currentStep ? ' is-active' : ''}${index < currentStep ? ' is-done' : ''}`}
                  onClick={() => setCurrentStep(index)}
                  aria-current={index === currentStep ? 'step' : undefined}
                >
                  <span className="form-steps__index">
                    {index < currentStep ? <Check size={14} strokeWidth={2} /> : index + 1}
                  </span>
                  {step.label}
                </button>
              </li>
            ))}
          </ol>

          <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
            <div className="panel">
              {currentStep === 0 && (
                <>
                  <FormField
                    id="lrn"
                    icon={IdCard}
                    label="LRN (12 digits)"
                    required
                    error={touched.lrn ? validateField('lrn', form.lrn) : null}
                    showSuccess={touched.lrn && Boolean(form.lrn)}
                  >
                    <input
                      id="lrn"
                      value={form.lrn}
                      onChange={(e) => update('lrn', e.target.value)}
                      onBlur={() => markTouched('lrn')}
                      required
                    />
                  </FormField>
                  <FormField
                    id="firstName"
                    icon={User}
                    label="First name"
                    required
                    error={touched.firstName ? validateField('firstName', form.firstName) : null}
                    showSuccess={touched.firstName && Boolean(form.firstName)}
                  >
                    <input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) => update('firstName', e.target.value)}
                      onBlur={() => markTouched('firstName')}
                      required
                    />
                  </FormField>
                  <FormField id="middleName" icon={User} label="Middle name">
                    <input id="middleName" value={form.middleName} onChange={(e) => update('middleName', e.target.value)} />
                  </FormField>
                  <FormField
                    id="lastName"
                    icon={User}
                    label="Last name"
                    required
                    error={touched.lastName ? validateField('lastName', form.lastName) : null}
                    showSuccess={touched.lastName && Boolean(form.lastName)}
                  >
                    <input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => update('lastName', e.target.value)}
                      onBlur={() => markTouched('lastName')}
                      required
                    />
                  </FormField>
                  <FormField id="sex" icon={UserRound} label="Sex">
                    <select id="sex" value={form.sex} onChange={(e) => update('sex', e.target.value)}>
                      <option value="">—</option>
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                  </FormField>
                  <FormField
                    id="dateOfBirth"
                    icon={Calendar}
                    label="Date of birth"
                    required
                    error={touched.dateOfBirth ? validateField('dateOfBirth', form.dateOfBirth) : null}
                    showSuccess={touched.dateOfBirth && Boolean(form.dateOfBirth)}
                  >
                    <input
                      id="dateOfBirth"
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={form.dateOfBirth}
                      onChange={(e) => update('dateOfBirth', e.target.value)}
                      onBlur={() => markTouched('dateOfBirth')}
                      required
                    />
                  </FormField>
                </>
              )}

              {currentStep === 1 && (
                <>
                  <FormField id="address" icon={MapPin} label="Address">
                    <input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} />
                  </FormField>
                  <FormField
                    id="email"
                    icon={Mail}
                    label="Personal email"
                    error={touched.email ? validateField('email', form.email) : null}
                    showSuccess={touched.email && Boolean(form.email) && !validateField('email', form.email)}
                  >
                    <input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                      onBlur={() => markTouched('email')}
                      placeholder="student's personal email (not a school account)"
                    />
                  </FormField>
                  <FormField id="guardianName" icon={Users} label="Guardian name">
                    <input id="guardianName" value={form.guardianName} onChange={(e) => update('guardianName', e.target.value)} />
                  </FormField>
                  <FormField id="guardianContactNumber" icon={Phone} label="Guardian contact number">
                    <input
                      id="guardianContactNumber"
                      value={form.guardianContactNumber}
                      onChange={(e) => update('guardianContactNumber', e.target.value)}
                    />
                  </FormField>
                  <FormField id="currentSectionId" icon={School} label="Section">
                    <select
                      id="currentSectionId"
                      value={form.currentSectionId}
                      onChange={(e) => update('currentSectionId', e.target.value)}
                    >
                      <option value="">No section</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          Grade {s.grade_level} - {s.name} ({s.school_year})
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField id="enrollmentStatus" icon={ClipboardCheck} label="Enrollment status">
                    <select
                      id="enrollmentStatus"
                      value={form.enrollmentStatus}
                      onChange={(e) => update('enrollmentStatus', e.target.value)}
                    >
                      {['pending', 'enrolled', 'dropped', 'transferred', 'graduated'].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </>
              )}

              {currentStep === 2 && (
                <div className="student-form-review">
                  <section>
                    <h3>Basic Information</h3>
                    <dl className="field-grid">
                      <dt>LRN</dt>
                      <dd>{form.lrn || '—'}</dd>
                      <dt>Name</dt>
                      <dd>{fullName || '—'}</dd>
                      <dt>Sex</dt>
                      <dd>{form.sex || '—'}</dd>
                      <dt>Date of birth</dt>
                      <dd>{form.dateOfBirth || '—'}</dd>
                    </dl>
                  </section>
                  <section>
                    <h3>Contact & Address</h3>
                    <dl className="field-grid">
                      <dt>Address</dt>
                      <dd>{form.address || '—'}</dd>
                      <dt>Email</dt>
                      <dd>{form.email || '—'}</dd>
                      <dt>Guardian</dt>
                      <dd>{form.guardianName || '—'}</dd>
                      <dt>Guardian contact</dt>
                      <dd>{form.guardianContactNumber || '—'}</dd>
                      <dt>Section</dt>
                      <dd>{sectionLabel || 'No section'}</dd>
                      <dt>Status</dt>
                      <dd>
                        <StatusPill label={form.enrollmentStatus} variant={STATUS_VARIANTS[form.enrollmentStatus]} />
                      </dd>
                    </dl>
                  </section>
                </div>
              )}

              {error && <p style={{ color: 'var(--color-danger)', marginTop: 'var(--space-4)' }}>{error}</p>}

              <div className="form-step-actions">
                {currentStep > 0 ? (
                  <button type="button" onClick={handleBack}>
                    <ChevronLeft size={16} strokeWidth={1.75} /> Back
                  </button>
                ) : (
                  <span />
                )}

                {currentStep < STEPS.length - 1 ? (
                  <button type="button" className="btn-primary" onClick={handleNext}>
                    Next <ChevronRight size={16} strokeWidth={1.75} />
                  </button>
                ) : (
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Student'}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>

        <aside className="panel student-form-preview">
          <div className="student-form-preview__avatar">
            {initials || <UserRound size={28} strokeWidth={1.75} />}
          </div>
          <div className={`student-form-preview__name${fullName ? '' : ' student-form-preview__name--placeholder'}`}>
            {fullName || 'New student'}
          </div>
          <dl className="field-grid student-form-preview__grid">
            <dt>LRN</dt>
            <dd>{form.lrn || '—'}</dd>
            <dt>Section</dt>
            <dd>{sectionLabel || '—'}</dd>
            <dt>Status</dt>
            <dd>
              <StatusPill label={form.enrollmentStatus} variant={STATUS_VARIANTS[form.enrollmentStatus]} />
            </dd>
          </dl>
        </aside>
      </div>
    </div>
  )
}
