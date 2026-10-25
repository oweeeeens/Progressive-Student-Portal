import { Megaphone, ArrowRight } from 'lucide-react'
import { formatAnnouncementDate } from '../utils/announcementFormat'

// The single most recent announcement, full width, at the very top of the
// student's home page. It carries the title and the opening of the body
// only — enough to decide whether to read it — and hands off to the
// announcements panel below for the rest, so the banner can never grow tall
// enough to push the student's own record off the first screen.
//
// `onViewDetails` opens that same announcement in the panel rather than
// navigating anywhere: the student experience is one scrolling page, so
// "full details" is an expansion further down it, not another route.
export function AnnouncementBanner({ announcement, onViewDetails }) {
  if (!announcement) return null

  return (
    <section className="announcement-banner">
      <div className="announcement-banner__icon">
        <Megaphone size={20} strokeWidth={1.75} />
      </div>
      <div className="announcement-banner__text">
        <p className="announcement-banner__title">{announcement.title}</p>
        <p className="announcement-banner__body">{announcement.body}</p>
      </div>
      <div className="announcement-banner__aside">
        <span className="announcement-banner__date">{formatAnnouncementDate(announcement.created_at)}</span>
        <button type="button" className="btn-subtle" onClick={() => onViewDetails(announcement.id)}>
          View details
          <ArrowRight size={14} strokeWidth={1.75} />
        </button>
      </div>
    </section>
  )
}
