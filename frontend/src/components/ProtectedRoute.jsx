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

  // The one place a bare word is right: which page is about to render is
  // not known yet, so there is no shape to draw. role="status" so a screen
  // reader is told rather than left on a silent page.
  if (loading) {
    return (
      <p className="app-boot-loading" role="status">
        Loading…
      </p>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return children
}
