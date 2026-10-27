import { useEffect, useState } from 'react'
import { api } from '../api/client'

// The staff counterpart to StudentHero: who is signed in, what they are
// responsible for, and what day it is.
//
// This replaces a plain "Welcome, Test" heading plus a three-field "Your
// account" card that sat in the right column leaving most of it empty. The
// identity belongs at the top of the page, not in a box beside it.

function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const ROLE_LABELS = {
  admin: 'Administrator',
  principal: 'Principal',
  registrar: 'Registrar',
  adviser: 'Adviser',
  subject_teacher: 'Subject Teacher',
  guidance_counselor: 'Guidance Counselor',
  ict_faculty: 'ICT Faculty',
}

export function StaffHero({ user, currentPeriod }) {
  // What this person is actually responsible for. An adviser's sections and
  // a subject teacher's classes come from the same endpoints the rest of the
  // app already uses — this adds no new server surface, and it is the one
  // fact that makes the greeting specific to them rather than generic.
  const [assignment, setAssignment] = useState(null)

  useEffect(() => {
    if (user.role === 'adviser') {
      api
        .get('/sections/mine')
        .then((data) => setAssignment(data.sections.map((s) => s.name).join(' · ') || null))
        .catch(() => setAssignment(null))
    } else if (user.role === 'subject_teacher') {
      api
        .get('/class-offerings/mine')
        .then((data) => {
          const subjects = [...new Set(data.classOfferings.map((c) => c.subject_name))]
          setAssignment(subjects.length ? `${subjects.length} class${subjects.length === 1 ? '' : 'es'}` : null)
        })
        .catch(() => setAssignment(null))
    }
  }, [user.role])

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <section className="portal-hero">
      <div className="portal-hero__body">
        <p className="portal-hero__greeting">{greeting()}</p>
        <h1 className="portal-hero__name">{user.fullName.split(' ')[0]}</h1>
        <p className="portal-hero__meta">
          {[ROLE_LABELS[user.role] || user.role, assignment, today, currentPeriod?.name].filter(Boolean).join('  ·  ')}
        </p>
      </div>
    </section>
  )
}
