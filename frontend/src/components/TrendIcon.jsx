import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// A small up/down/flat glyph for a trend number (grade trend, attendance
// trend, ...) — shared by Academic Progress Tracking and My Progress so the
// same trend reads the same way everywhere it appears. null/undefined means
// "not enough periods yet to compute a trend," not zero, so it renders
// nothing rather than a misleading flat dash.
export function TrendIcon({ trend }) {
  if (trend == null) return null
  const value = Number(trend)
  if (value > 0) return <TrendingUp size={14} strokeWidth={2} className="trend-icon trend-icon--up" />
  if (value < 0) return <TrendingDown size={14} strokeWidth={2} className="trend-icon trend-icon--down" />
  return <Minus size={14} strokeWidth={2} className="trend-icon trend-icon--flat" />
}
