import { createContext, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

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

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, markPasswordChanged }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
