import { useEffect, useState } from 'react'
import { Layers, BookOpen } from 'lucide-react'
import { api } from '../api/client'
import { Alert } from './Alert'

// "Advisory section" and "Classes taught" for an adviser or subject-teacher
// account, on the New Account and Edit Account forms (admin only).
//
// Why it exists: every adviser and teacher feature is earned by an
// assignment — the section's adviser, the class's teacher — never by the
// role label. An account created without one signed in to an almost empty
// menu. Linking here writes the same two columns Academic Setup does, in the
// same request that saves the account (backend/services/staffAssignment.js).
//
// Options come from GET /users/assignable-targets: this school year's active
// sections and classes, each with whoever holds it now, so the form can say
// who would lose it before anything moves.

export const EMPTY_ASSIGNMENT = { sectionId: '', offeringIds: [] }

// The section and classes this choice would take away from someone else —
// used by the form's confirm dialog ("STEM A moves from Robles").
export function describeTakeovers(targets, value, userId) {
  if (!targets) return []
  const lines = []
  const section = targets.sections.find((s) => String(s.id) === String(value.sectionId))
  if (section && section.adviser_id && section.adviser_id !== userId) {
    lines.push(`Grade ${section.grade_level} – ${section.name}: advised by ${section.adviser_name} now; it moves to this account.`)
  }
  for (const id of value.offeringIds) {
    const o = targets.classOfferings.find((c) => c.id === id)
    if (o && o.teacher_id && o.teacher_id !== userId) {
      lines.push(`${o.section_name} – ${o.subject_name}: taught by ${o.teacher_name} now; it moves to this account.`)
    }
  }
  return lines
}

// The request fields for the account endpoints, or {} when nothing is picked.
export function assignmentPayload(value) {
  const payload = {}
  if (value.sectionId) payload.advisorySectionId = Number(value.sectionId)
  if (value.offeringIds.length > 0) payload.classOfferingIds = value.offeringIds
  return payload
}

export function AssignmentPicker({ value, onChange, userId = null, onTargetsLoaded }) {
  const [targets, setTargets] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api
      .get('/users/assignable-targets')
      .then((data) => {
        if (cancelled) return
        setTargets(data)
        onTargetsLoaded?.(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
    // Loaded once per form; onTargetsLoaded is a setter from the parent.
  }, [])

  // A failed load must say so, not look like "there are no sections".
  if (error) return <Alert>Couldn't load the sections and classes to link: {error}</Alert>
  if (!targets) return <p className="form-note">Loading sections and classes…</p>

  function toggleOffering(id) {
    const offeringIds = value.offeringIds.includes(id)
      ? value.offeringIds.filter((x) => x !== id)
      : [...value.offeringIds, id]
    onChange({ ...value, offeringIds })
  }

  const holderNote = (holderId, holderName) =>
    holderId === userId ? ' (this account)' : holderName ? ` (now: ${holderName})` : ''

  return (
    <fieldset className="assignment-picker">
      <legend>Link to a section and classes</legend>
      <p className="form-note">
        What this account can do comes from what it is linked to: the section it advises opens Daily Attendance,
        Finalize Grades, Interventions and the SF2 import; the classes it teaches open the Class Record and the
        e-Class Record import. Both are optional and can be changed later.
      </p>

      <label>
        <span className="assignment-picker__label">
          <Layers size={16} strokeWidth={1.75} /> Advisory section
        </span>
        <select value={value.sectionId} onChange={(e) => onChange({ ...value, sectionId: e.target.value })}>
          <option value="">— None for now —</option>
          {targets.sections.map((s) => (
            <option key={s.id} value={s.id}>
              Grade {s.grade_level} – {s.name}
              {holderNote(s.adviser_id, s.adviser_name)}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="assignment-picker__label">
          <BookOpen size={16} strokeWidth={1.75} /> Classes taught
        </span>
        {targets.classOfferings.length === 0 ? (
          <p className="form-note">No classes are set up for this school year yet (Academic Setup → Class Offerings).</p>
        ) : (
          <div className="assignment-picker__classes" role="group" aria-label="Classes taught">
            {targets.classOfferings.map((o) => (
              <label key={o.id} className="assignment-picker__class">
                <input type="checkbox" checked={value.offeringIds.includes(o.id)} onChange={() => toggleOffering(o.id)} />
                <span>
                  {o.section_name} – {o.subject_name}
                  <small>{holderNote(o.teacher_id, o.teacher_name)}</small>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </fieldset>
  )
}
