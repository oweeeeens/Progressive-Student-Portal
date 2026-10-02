import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { StatusPill } from './StatusPill'
import './StudentsNeedingAttention.css'

const RISK_VARIANTS = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high' }

// Visible to admin/adviser/guidance_counselor only — see
// backend/models/dashboardModel.js's getTopAtRiskStudents, which returns an
// empty list for every other role, so this simply renders nothing for them.
export function StudentsNeedingAttention() {
  const [students, setStudents] = useState(null)

  useEffect(() => {
    api
      .get('/dashboard/attention')
      .then((data) => setStudents(data.students))
      .catch(() => setStudents([]))
  }, [])

  if (students !== null && students.length === 0) return null

  return (
    <aside className="panel attention-widget">
      <h2>Students Needing Attention</h2>
      {!students ? (
        <div aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: '3.5rem', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)' }} />
          ))}
        </div>
      ) : (
        <ul className="attention-widget__list">
          {students.map((s) => (
            <li key={s.studentId}>
              <Link to={`/students/${s.studentId}`} className="attention-widget__item">
                <div className="attention-widget__row">
                  <span className="attention-widget__name">
                    {s.lastName}, {s.firstName}
                  </span>
                  <StatusPill label={s.riskLevel} variant={RISK_VARIANTS[s.riskLevel]} />
                </div>
                {s.primaryFactor && <p className="attention-widget__factor">{s.primaryFactor}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
