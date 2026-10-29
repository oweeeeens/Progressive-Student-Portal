import { useEffect, useRef, useState } from 'react'

// `tabs`: [{ key, label, icon?, content }]. Uncontrolled by default (picks
// its own active tab) — fine for every current use, which is one Tabs per
// page with nothing outside it needing to know which tab is open.
export function Tabs({ tabs, defaultTab }) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.key)
  const activeTab = tabs.find((tab) => tab.key === active) || tabs[0]
  const listRef = useRef(null)

  // On a phone the strip is wider than the screen — Analytics' five tabs
  // measure 569px against a 308px viewport — so selecting a tab off to the
  // right would leave the selected tab out of sight, with the underline
  // that marks it invisible.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({
      inline: 'nearest',
      // 'nearest' and not the default 'start': the page scrolls inside
      // .app-shell__content, so 'start' would scroll the whole page
      // vertically to bring the tab strip to the top of the viewport —
      // yanking the reader somewhere they did not ask to go, every time
      // they change tab.
      block: 'nearest',
    })
  }, [active])

  return (
    <div>
      <div className="tabs" role="tablist" ref={listRef}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab?.key === tab.key}
            className={`tabs__item${activeTab?.key === tab.key ? ' is-active' : ''}`}
            onClick={() => setActive(tab.key)}
          >
            {tab.icon && <tab.icon size={16} strokeWidth={1.75} />}
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{activeTab?.content}</div>
    </div>
  )
}
