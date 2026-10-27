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
import { Alert } from '../components/Alert'
import { humanize } from '../utils/humanize'

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
  // 'enrolled', not 'pending' — enrollment now happens on paper before a
  // record is added here (see CLAUDE.md's "REMOVED: Enrollment Management"),
  // so a new student added through this form has, by definition, already
  // enrolled. 'pending' is still a selectable option for the rare case a
  // record is entered ahead of paperwork being finalized.
  enrollmentStatus: 'enrolled',
  // Descriptive learner-status flags for DepEd reporting. Default false:
  // "not recorded" and "no" are the same thing for a reporting checkbox.
  // Deliberately NOT inputs to the risk formula — see
  // backend/config/learnerStatus.js.
  isPwd: false,
  is4ps: false,
  isAlsGraduate: false,
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
    // A role that can't see one of these never receives it (the API strips
    // it), so an absent field reads as false rather than crashing the form.
    isPwd: student.is_pwd === true,
    is4ps: student.is_4ps === true,
    isAlsGraduate: student.is_als_graduate === true,
  }
}

// Mirrors backend/config/learnerStatus.js. Both roles that can reach this
// form (admin, registrar) may see all three, so there's no per-field gate
// here — the server strips anything a writer isn't allowed to set anyway.
const LEARNER_STATUS_INPUTS = [
  { key: 'isPwd', label: 'Person with disability (PWD)' },
  { key: 'is4ps', label: '4Ps recipient' },
  {
    key: 'isAlsGraduate',
    label: 'ALS graduate',
    hint: 'Alternative Learning System. System field — not in the DepEd template.',
  },
]

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

// `width`: 'short' or 'medium' caps the control's width. A 12-digit LRN or
// a two-option Sex select stretched across a 680px panel reads as a field
// expecting a sentence; the box should suggest how much is wanted.
function FormField({ id, icon: Icon, label, required, error, showSuccess, width, children }) {
  return (
    <div className={`form-field${width ? ` form-field--${width}` : ''}`}>
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
      // Portal accounts are never auto-created on save — a registrar/admin
      // creates one as a deliberate separate step (Student Detail page's
      // "Create Portal Account" button, or User Management) once this
      // record exists. See CLAUDE.md's "REMOVED: Enrollment Management".
      navigate(`/students/${data.student.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const selectedSection = sections.find((s) => String(s.id) === String(form.currentSectionId))
  const sectionLabel = selectedSection ? `Grade ${selectedSection.grade_level} - ${selectedSection.name}` : null
  const fullName = `${form.firstName} ${form.lastName}`.trim()

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

      {/* One column. A preview card used to sit beside this form
          showing the LRN, section and status that the fields themselves
          already display, on a page whose third step is a full review —
          the same values in three places at once. The review step is the
          one worth keeping, so the form gets the width instead. */}
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
                <div className="form-step__fields">
                  <FormField
                    id="lrn"
                    icon={IdCard}
                    label="LRN (12 digits)"
                    width="medium"
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
                    width="wide"
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
                  <FormField width="wide" id="middleName" icon={User} label="Middle name">
                    <input id="middleName" value={form.middleName} onChange={(e) => update('middleName', e.target.value)} />
                  </FormField>
                  <FormField
                    width="wide"
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
                  <FormField id="sex" icon={UserRound} label="Sex" width="short">
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
                    width="short"
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
                </div>
              )}

              {currentStep === 1 && (
                <div className="form-step__fields">
                  <FormField width="wide" id="address" icon={MapPin} label="Address">
                    <input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} />
                  </FormField>
                  <FormField
                    width="wide"
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
                  <FormField width="wide" id="guardianName" icon={Users} label="Guardian name">
                    <input id="guardianName" value={form.guardianName} onChange={(e) => update('guardianName', e.target.value)} />
                  </FormField>
                  <FormField id="guardianContactNumber" icon={Phone} label="Guardian contact number" width="medium">
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
                  <FormField id="enrollmentStatus" icon={ClipboardCheck} label="Enrollment status" width="medium">
                    <select
                      id="enrollmentStatus"
                      value={form.enrollmentStatus}
                      onChange={(e) => update('enrollmentStatus', e.target.value)}
                    >
                      {/* The value stays the database enum; only the label is
                          humanised, so this dropdown reads the same way the
                          record and the status pill do. */}
                      {['pending', 'enrolled', 'dropped', 'transferred', 'graduated'].map((s) => (
                        <option key={s} value={s}>
                          {humanize(s)}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  {/* Reporting flags, grouped and labelled as such so nobody
                      reads them as part of the risk assessment. ALS graduate
                      is marked a System field because it has no column in
                      the school's Student Information template — it's set
                      here by hand, or inferred on bulk import and confirmed. */}
                  <fieldset className="learner-status-fieldset form-field--wide">
                    <legend>Learner status (for DepEd reporting)</legend>
                    {LEARNER_STATUS_INPUTS.map((field) => (
                      <label key={field.key} className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={form[field.key]}
                          onChange={(e) => update(field.key, e.target.checked)}
                        />
                        <span>
                          {field.label}
                          {field.hint && <span className="checkbox-field__hint">{field.hint}</span>}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}

              {currentStep === 2 && (
                <div className="student-form-review">
                  <section>
                    <h3>Basic Information</h3>
                    <dl className="field-grid">
                      <div>
                        <dt>LRN</dt>
                        <dd>{form.lrn || '—'}</dd>
                      </div>
                      <div>
                        <dt>Name</dt>
                        <dd>{fullName || '—'}</dd>
                      </div>
                      <div>
                        <dt>Sex</dt>
                        <dd>{form.sex || '—'}</dd>
                      </div>
                      <div>
                        <dt>Date of birth</dt>
                        <dd>{form.dateOfBirth || '—'}</dd>
                      </div>
                    </dl>
                  </section>
                  <section>
                    <h3>Contact & Address</h3>
                    <dl className="field-grid">
                      <div>
                        <dt>Address</dt>
                        <dd>{form.address || '—'}</dd>
                      </div>
                      <div>
                        <dt>Email</dt>
                        <dd>{form.email || '—'}</dd>
                      </div>
                      <div>
                        <dt>Guardian</dt>
                        <dd>{form.guardianName || '—'}</dd>
                      </div>
                      <div>
                        <dt>Guardian contact</dt>
                        <dd>{form.guardianContactNumber || '—'}</dd>
                      </div>
                      <div>
                        <dt>Section</dt>
                        <dd>{sectionLabel || 'No section'}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>
                          <StatusPill label={form.enrollmentStatus} variant={STATUS_VARIANTS[form.enrollmentStatus]} />
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
              )}

              {error && <Alert>{error}</Alert>}

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

      </div>
    </div>
  )
}
