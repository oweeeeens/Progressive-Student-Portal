import { useState } from 'react'
import { Paperclip, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../api/client'
import { Pagination } from '../components/Pagination'
import { announcementByline, formatAnnouncementDate } from '../utils/announcementFormat'
import { Alert } from './Alert'

// A compact, paginated, read-only announcements list — the student-facing
// counterpart to the staff dashboard's feed. Each row is just title, date
// posted, and a "View Details" disclosure; the full body, byline, and any
// attachment expand in place.
//
// Expanding in place (rather than opening a modal or a separate route) is
// what the rest of the app already does for detail-on-demand — see
// InterventionDetailPanel and DataTable's renderExpanded — and it keeps the
// promise that the student experience is one scrolling page.
//
// `expandedId` is owned by the caller because the banner above this panel
// opens an item here; `onToggle` reports a row's own click back up.
export function AnnouncementsPanel({ announcements, page, totalPages, onPageChange, expandedId, onToggle }) {
  const [downloadError, setDownloadError] = useState(null)

  function handleDownload(announcement) {
    setDownloadError(null)
    api
      .downloadFile(`/announcements/${announcement.id}/file`, announcement.original_filename)
      .catch((err) => setDownloadError(err.message))
  }

  return (
    <aside className="panel announcements-panel">
      <h2>Announcements</h2>

      {!announcements ? (
        <div aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div className="announcement-item" key={i}>
              <div className="skeleton" style={{ width: '70%', height: '1rem', marginBottom: 'var(--space-2)' }} />
              <div className="skeleton" style={{ width: '40%', height: '0.8125rem' }} />
            </div>
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="empty-state">
          <p>No announcements yet.</p>
          <p>Anything the school posts will show up here.</p>
        </div>
      ) : (
        <ul className="announcement-list">
          {announcements.map((a) => {
            const expanded = expandedId === a.id
            return (
              <li className="announcement-item" key={a.id}>
                <p className="announcement-item__title">{a.title}</p>
                <div className="announcement-item__meta">
                  <span>{formatAnnouncementDate(a.created_at)}</span>
                  <button
                    type="button"
                    className="btn-subtle"
                    onClick={() => onToggle(a.id)}
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Hide' : 'View Details'}
                    {expanded ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
                  </button>
                </div>
                {expanded && (
                  <div className="announcement-item__detail">
                    <p className="announcement-item__byline">{announcementByline(a)}</p>
                    <p className="announcement-item__body">{a.body}</p>
                    {a.original_filename && (
                      <button type="button" className="btn-subtle" onClick={() => handleDownload(a)}>
                        <Paperclip size={14} strokeWidth={1.75} />
                        {a.original_filename}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {downloadError && <Alert>{downloadError}</Alert>}

      <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </aside>
  )
}
