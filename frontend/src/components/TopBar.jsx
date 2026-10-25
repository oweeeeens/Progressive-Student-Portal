import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Maximize, Minimize, Sun, Moon, PanelLeftClose, PanelLeftOpen, KeyRound, IdCard, ChevronDown } from 'lucide-react'
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

export function TopBar({ sidebarCollapsed, onToggleSidebar }) {
  const { user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const [gradingPeriod, setGradingPeriod] = useState(null)
  // Account actions that belong to the person rather than to a page. They
  // live here, not in the sidebar, because the sidebar is the product's
  // navigation — and for a student it is deliberately a single item (Home).
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef(null)

  useEffect(() => {
    const handleChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  // A menu that can only be closed by clicking the button that opened it is
  // a trap on touch devices; Escape and an outside click both close it.
  useEffect(() => {
    if (!accountMenuOpen) return undefined
    function handlePointerDown(event) {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [accountMenuOpen])

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
        <button
          type="button"
          className="top-bar__icon-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.75} />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.75} />
          )}
        </button>
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
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
        </button>

        <button
          type="button"
          className="top-bar__icon-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize size={16} strokeWidth={1.75} /> : <Maximize size={16} strokeWidth={1.75} />}
        </button>

        <div className="top-bar__account" ref={accountMenuRef}>
          <button
            type="button"
            className="top-bar__profile"
            onClick={() => setAccountMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            title={user.fullName}
          >
            <span className="top-bar__avatar">{getInitials(user.fullName)}</span>
            <span className="top-bar__profile-text">
              <strong>{user.fullName}</strong>
              <span>{user.role.replace(/_/g, ' ')}</span>
            </span>
            <ChevronDown size={14} strokeWidth={1.75} className="top-bar__profile-caret" />
          </button>

          {accountMenuOpen && (
            <div className="account-menu" role="menu">
              {/* Repeated inside the menu because the button's own label is
                  hidden on narrow screens, where the avatar is all there is. */}
              <div className="account-menu__identity">
                <strong>{user.fullName}</strong>
                <span>{user.email}</span>
              </div>

              {user.role === 'student' && (
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu__item"
                  onClick={() => {
                    setAccountMenuOpen(false)
                    // The student's whole portal is one page, so this opens
                    // the record section in place rather than routing
                    // somewhere — the timestamp makes every click a new
                    // state value, so it works twice in a row.
                    navigate('/', { state: { openRecord: Date.now() } })
                  }}
                >
                  <IdCard size={15} strokeWidth={1.75} />
                  Your record on file
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                className="account-menu__item"
                onClick={() => {
                  setAccountMenuOpen(false)
                  navigate('/change-password')
                }}
              >
                <KeyRound size={15} strokeWidth={1.75} />
                Change password
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
