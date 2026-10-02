import { Fragment } from 'react'
import { Link } from 'react-router-dom'

// items: [{ label, to }] — the last item is the current page and renders as
// plain text rather than a link, so the trail never links to where you are.
export function Breadcrumbs({ items }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <Fragment key={item.label}>
            {index > 0 && <span className="breadcrumbs__separator">/</span>}
            {isLast || !item.to ? (
              <span className="breadcrumbs__current" aria-current="page">
                {item.label}
              </span>
            ) : (
              <Link to={item.to}>{item.label}</Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
