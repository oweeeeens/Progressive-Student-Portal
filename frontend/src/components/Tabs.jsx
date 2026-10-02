import { useState } from 'react'

// `tabs`: [{ key, label, icon?, content }]. Uncontrolled by default (picks
// its own active tab) — fine for every current use, which is one Tabs per
// page with nothing outside it needing to know which tab is open.
export function Tabs({ tabs, defaultTab }) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.key)
  const activeTab = tabs.find((tab) => tab.key === active) || tabs[0]

  return (
    <div>
      <div className="tabs" role="tablist">
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
