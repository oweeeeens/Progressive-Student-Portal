import { useEffect, useState } from 'react'
import { Maximize, Minimize, Sun, Moon } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import './TopBar.css'

function getInitials(fullName) {
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

export function TopBar() {
  const { user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const [gradingPeriod, setGradingPeriod] = useState(null)

  useEffect(() => {
    const handleChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  useEffect(() => {
    api
      .get('/grading-periods/current')
      .then((data) => setGradingPeriod(data.gradingPeriod))
      .catch(() => setGradingPeriod(null))
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen().catch(() => {
        // Fullscreen can be denied by the browser/embedding context — fail
        // quietly rather than surfacing an error for a non-essential toggle.
      })
    }
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  if (!user) return null

  return (
    <header className="top-bar">
      <div className="top-bar__context">
        <span className="top-bar__date">{today}</span>
        {gradingPeriod && (
          <span className="pill pill--info">
            {gradingPeriod.name}, {gradingPeriod.schoolYearLabel}
          </span>
        )}
      </div>

      <div className="top-bar__actions">
        <button
          type="button"
          className="top-bar__icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </button>

        <button
          type="button"
          className="top-bar__icon-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize size={18} strokeWidth={1.75} /> : <Maximize size={18} strokeWidth={1.75} />}
        </button>

        <div className="top-bar__profile" title={user.fullName}>
          <span className="top-bar__avatar">{getInitials(user.fullName)}</span>
          <span className="top-bar__profile-text">
            <strong>{user.fullName}</strong>
            <span>{user.role.replace(/_/g, ' ')}</span>
          </span>
        </div>
      </div>
    </header>
  )
}
