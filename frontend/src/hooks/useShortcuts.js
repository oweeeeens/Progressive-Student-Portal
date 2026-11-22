import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Keyboard shortcuts for the two things people do most often from anywhere
// (Nielsen #7, "flexibility and efficiency of use": accelerators that an
// expert uses and a novice never has to know about):
//
//   /   jump to the page's search box
//   ?   open Help
//
// WCAG 2.2 SC 2.1.4 (Character Key Shortcuts, Level A): a shortcut made of a
// single printable key must be possible to TURN OFF, because speech-input
// users can trigger it by accident while dictating. The switch is on the Help
// page, stored per browser — it is a personal convenience, not data.
//
// Never fires while the person is typing in a field, or with Ctrl/Alt/Meta
// held (those combinations belong to the browser).
export const SHORTCUTS_KEY = 'studentPortal.shortcutsOff'

export function readShortcutsEnabled() {
  try {
    return localStorage.getItem(SHORTCUTS_KEY) !== 'true'
  } catch {
    return true
  }
}

export function writeShortcutsEnabled(enabled) {
  try {
    localStorage.setItem(SHORTCUTS_KEY, String(!enabled))
  } catch {
    // Blocked storage: the choice lasts for this page load only.
  }
  window.dispatchEvent(new Event('studentportal:shortcuts'))
}

// True when a key press is going into something the person is typing in.
function isTyping(target) {
  if (!target || !(target instanceof Element)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [role="textbox"]'))
}

export function useShortcuts() {
  const navigate = useNavigate()
  const [enabled, setEnabled] = useState(readShortcutsEnabled)

  // The Help page's switch tells every open shell to re-read the choice.
  useEffect(() => {
    const sync = () => setEnabled(readShortcutsEnabled())
    window.addEventListener('studentportal:shortcuts', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('studentportal:shortcuts', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    function handleKeyDown(event) {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
      if (isTyping(event.target)) return
      // An open dialog owns the keyboard.
      if (document.querySelector('dialog[open]')) return
      if (event.key === '/') {
        const search = document.querySelector('[data-shortcut-search]')
        if (search) {
          event.preventDefault()
          search.focus()
        }
      } else if (event.key === '?') {
        event.preventDefault()
        navigate('/help')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, navigate])
}
