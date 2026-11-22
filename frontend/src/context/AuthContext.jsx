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
  // Whether the last count FAILED, as opposed to not having arrived yet.
  // The two used to be the same null, so on every sign-in the menu showed
  // every role-eligible link for a moment and then removed the ones this
  // person does not hold — a guidance counselor watched "Interventions"
  // appear and vanish (found by the HCI audit, 2026-11-22: navigation that
  // shifts under the pointer breaks "no surprises").
  const [assignmentsFailed, setAssignmentsFailed] = useState(false)

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
  // Bumped to re-count. Two moments matter: right after the forced first
  // password change (before it the server refuses /sections/mine, so a
  // brand-new account's counts always failed), and when the window regains
  // focus, so an account the admin links while it is signed in picks up its
  // section without signing out.
  const [assignmentsVersion, setAssignmentsVersion] = useState(0)
  const mustChangePassword = Boolean(user?.mustChangePassword)

  useEffect(() => {
    const onFocus = () => setAssignmentsVersion((v) => v + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    if (!userId || userRole === 'student' || mustChangePassword) {
      setAssignments(null)
      setAssignmentsFailed(false)
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
      if (!sec || !off) {
        setAssignmentsFailed(true)
        return
      }
      setAssignmentsFailed(false)
      setAssignments({
        sections: (sec.sections || []).length,
        offerings: (off.classOfferings || []).length,
      })
    })
    return () => {
      cancelled = true
    }
  }, [userId, userRole, mustChangePassword, assignmentsVersion])

  // `remember` is sent to the server as well as deciding the storage: the
  // server makes a remembered sign-in last 30 days instead of 8 hours. Before
  // 2026-11-15 only the storage changed, so a "remembered" sign-in still
  // expired overnight.
  // What the MENUS use (sidebar, Help, Import Data):
  //   - the real counts once known;
  //   - zero while they are on their way, so the role's own links show at
  //     once and the assignment-only links appear when earned, instead of
  //     every link showing and some then disappearing;
  //   - null if the count FAILED, which the menus treat as "show every
  //     role-eligible link" (a cluttered menu, never a missing grade sheet).
  const navAssignments = assignments || (assignmentsFailed ? null : { sections: 0, offerings: 0 })

  async function login(email, password, remember = true) {
    const data = await api.post('/auth/login', { email, password, remember: Boolean(remember) })
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
    <AuthContext.Provider value={{ user, loading, assignments, navAssignments, login, logout, markPasswordChanged, applyProfileUpdate }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
