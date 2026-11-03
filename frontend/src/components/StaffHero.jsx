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

  // BOTH endpoints, for everyone — not one branch per role label.
  //
  // This used to read `if (role === 'adviser') … else if (role ===
  // 'subject_teacher') …`, so a teacher who advises one section and teaches
  // subjects to others saw only the half that matched their role column. In
  // this school that is the ordinary case, not an edge case, and the whole
  // point of the greeting is to name what this person is actually
  // responsible for today.
  //
  // Students are skipped: they hold neither assignment, so the two requests
  // could only ever come back empty.
  useEffect(() => {
    if (user.role === 'student') return undefined

    let cancelled = false
    Promise.all([
      api.get('/sections/mine').catch(() => null),
      api.get('/class-offerings/mine').catch(() => null),
    ]).then(([sec, off]) => {
      if (cancelled) return
      const sections = sec?.sections || []
      const offerings = off?.classOfferings || []

      // Advised sections are named; taught classes are counted. A name is
      // what an adviser recognises their register by, while a teacher with
      // five classes across three sections would turn this line into a
      // paragraph — the profile page lists them individually instead.
      const parts = []
      if (sections.length) parts.push(sections.map((s) => s.name).join(' · '))
      if (offerings.length) parts.push(`${offerings.length} class${offerings.length === 1 ? '' : 'es'}`)
      setAssignment(parts.join(' · ') || null)
    })

    return () => {
      cancelled = true
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
