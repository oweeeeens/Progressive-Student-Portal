import { useEffect, useState } from 'react'
import { ClipboardList, FileCheck2 } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import './UserInfoCard.css'

// What counts as "your pending task" depends on role, and reuses the same
// stats the dashboard's own stat row already fetched — no new numbers
// invented just for this card, no second request for data already on screen.
function getTaskInfo(user, stats) {
  if (['admin', 'registrar'].includes(user.role) && stats?.pendingDocuments !== undefined) {
    return { Icon: FileCheck2, label: 'documents awaiting review', value: stats.pendingDocuments }
  }
  if (['adviser', 'guidance_counselor'].includes(user.role) && stats?.openInterventions !== undefined) {
    return { Icon: ClipboardList, label: 'open interventions', value: stats.openInterventions }
  }
  return null
}

// A quick-glance "who's logged in and what's on their plate" card, next to
// the announcements feed on the dashboard. Sections (adviser) and class
// offerings (subject_teacher) reuse the same /sections/mine and
// /class-offerings/mine endpoints already used elsewhere in the app.
export function UserInfoCard({ stats }) {
  const { user } = useAuth()
  const [sections, setSections] = useState(null)
  const [classOfferings, setClassOfferings] = useState(null)

  useEffect(() => {
    if (user.role === 'adviser') {
      api
        .get('/sections/mine')
        .then((data) => setSections(data.sections))
        .catch(() => setSections([]))
    } else if (user.role === 'subject_teacher') {
      api
        .get('/class-offerings/mine')
        .then((data) => setClassOfferings(data.classOfferings))
        .catch(() => setClassOfferings([]))
    }
  }, [user.role])

  const taskInfo = getTaskInfo(user, stats)

  return (
    <aside className="panel profile-card">
      <h2>Your account</h2>
      <dl className="field-grid profile-card__grid">
        <dt>Name</dt>
        <dd>{user.fullName}</dd>
        <dt>Role</dt>
        <dd className="profile-card__role">{user.role.replace(/_/g, ' ')}</dd>
        {sections && sections.length > 0 && (
          <>
            <dt>{sections.length > 1 ? 'Sections' : 'Section'}</dt>
            <dd>{sections.map((s) => `Grade ${s.grade_level} - ${s.name}`).join(', ')}</dd>
          </>
        )}
        {classOfferings && classOfferings.length > 0 && (
          <>
            <dt>Classes</dt>
            <dd>
              {classOfferings.length} {classOfferings.length === 1 ? 'class' : 'classes'} this term
            </dd>
          </>
        )}
      </dl>

      {taskInfo && (
        <div className="profile-card__task">
          <taskInfo.Icon size={18} strokeWidth={1.75} />
          <span>
            {taskInfo.value} {taskInfo.label}
          </span>
        </div>
      )}
    </aside>
  )
}
