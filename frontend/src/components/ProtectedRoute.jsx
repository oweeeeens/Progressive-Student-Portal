import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Redirects to /login when not authenticated, and to /change-password when
// the account has a forced password change pending (temp password from
// staff account creation or student auto-provisioning — see backend
// authMiddleware.js, which enforces this same rule server-side; this is UX,
// not the actual security boundary). Role-based route restriction is
// handled per-page, same reasoning.
export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <p style={{ padding: '2rem' }}>Loading...</p>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return children
}
