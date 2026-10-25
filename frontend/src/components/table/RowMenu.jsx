import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'

// The ONE row-action pattern: a kebab menu at the right end of every row
// that has actions. Before this, one table used inline text links, another
// used icon buttons and a third had nothing — so "where do I act on a row"
// had a different answer per page.
//
// `actions`: [{ key, label, icon, onSelect, danger, disabled, title }].
// A page passes what the row can do; it never decides how that looks.
export function RowMenu({ actions, label = 'Row actions' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on an outside click or Escape — a menu that can only be dismissed
  // by picking something is a trap, especially mid-table.
  useEffect(() => {
    if (!open) return undefined
    function onDocPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const available = actions.filter(Boolean)
  if (available.length === 0) return null

  return (
    <div className="row-menu" ref={wrapRef}>
      <button
        type="button"
        className="row-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        // Rows are clickable, so every control inside one has to stop the
        // click reaching the row or opening the menu would also navigate.
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MoreVertical size={16} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="row-menu__sheet" role="menu">
          {available.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className={`row-menu__item${action.danger ? ' is-danger' : ''}`}
              disabled={action.disabled}
              title={action.title}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                action.onSelect()
              }}
            >
              {action.icon && <action.icon size={14} strokeWidth={1.75} />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
