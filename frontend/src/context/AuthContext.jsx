import { createContext, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // What this person actually advises and teaches, counted once per session.
  //
  // The sidebar needs it: write access to the attendance and grade pages is
  // decided by sections.adviser_id and class_offerings.teacher_id, never by
  // the role label, so role alone cannot tell whether a link leads anywhere.
  // Guessing from the role left five dead links on the principal's nav and
  // two on an adviser who happens not to teach.
  //
  // null = not known yet. Falls back to null on failure too, which the
  // sidebar treats as "show the role-eligible links" — a failed count should
  // degrade to a slightly cluttered menu, never to a teacher who cannot
  // reach their own grade sheet.
  const [assignments, setAssignments] = useState(null)

  // On load, if a token is already stored, confirm it's still valid and
  // fetch the current user rather than trusting a locally-cached profile.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .get('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  // Counted after we know who they are, and not for students, who hold
  // neither kind of assignment and see none of those pages anyway.
  // Pulled out of `user` by name, because those two fields are the whole of
  // what this effect depends on: a profile save or markPasswordChanged
  // replaces the user object and would otherwise re-run two requests whose
  // answer cannot have changed.
  const userId = user?.id
  const userRole = user?.role

  useEffect(() => {
    if (!userId || userRole === 'student') {
      setAssignments(null)
      return
    }
    let cancelled = false
    Promise.all([
      api.get('/sections/mine').catch(() => null),
      api.get('/class-offerings/mine').catch(() => null),
    ]).then(([sec, off]) => {
      if (cancelled) return
      // Either request failing leaves this null, so the sidebar falls back
      // to role-only visibility rather than hiding a page someone needs.
      if (!sec || !off) return
      setAssignments({
        sections: (sec.sections || []).length,
        offerings: (off.classOfferings || []).length,
      })
    })
    return () => {
      cancelled = true
    }
  }, [userId, userRole])

  async function login(email, password, remember = true) {
    const data = await api.post('/auth/login', { email, password })
    setToken(data.token, remember)
    setUser(data.user)
  }

  function logout() {
    setToken(null)
    setUser(null)
  }

  // Called after a successful POST /auth/change-password so the forced-
  // password-change redirect (see ProtectedRoute) clears immediately,
  // without needing a full re-fetch of /auth/me.
  function markPasswordChanged() {
    setUser((u) => (u ? { ...u, mustChangePassword: false } : u))
  }

  // Called after a successful PATCH /auth/profile. The server returns the
  // saved row, so this takes that rather than the form's own state — if the
  // server normalised the email's case or trimmed the name, the header and
  // the account menu show what was actually stored.
  function applyProfileUpdate(updatedUser) {
    setUser((u) => (u ? { ...u, ...updatedUser } : u))
  }

  return (
    <AuthContext.Provider value={{ user, loading, assignments, login, logout, markPasswordChanged, applyProfileUpdate }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
