// Where one figure stands against the target it has to reach — the form for
// actual-vs-target, which is what every line in "What would move you out of
// this band" actually is.
//
// Not a trend chart: the two trend charts further down this page already
// plot these same measures over time, and drawing them twice would say
// nothing new. This answers the other question — how far is it to the line
// — which a sentence can state but cannot show.
//
// Only ever used for measures that have a real position on a fixed scale (a
// grade out of 100, an attendance rate out of 100%). A rate of change has no
// honest position on such a scale, so trend factors deliberately keep their
// sentence instead of being forced into a bar with an invented axis.
//
// The numbers live in the text above and below the track, so the track
// itself is decoration for a screen reader and is hidden from it.
export function TargetBar({ label, current, target, max = 100, unit = '', gapNoun = 'points' }) {
  if (current == null || target == null) return null

  const clamp = (value) => Math.max(0, Math.min(100, (value / max) * 100))
  const hasReached = current >= target
  const gap = Math.round(Math.abs(target - current) * 10) / 10

  return (
    <div className="target-bar">
      <div className="target-bar__head">
        <span className="target-bar__label">{label}</span>
        <span className="target-bar__values">
          <strong className={hasReached ? undefined : 'is-below'}>
            {current}
            {unit}
          </strong>
          <span>
            {' '}
            · needs {target}
            {unit}
          </span>
        </span>
      </div>

      <div className="target-bar__track" aria-hidden="true">
        {/* Revealed by clip-path rather than sized by width — the same
            technique .bar-chart__fill uses, and for the same reason:
            animating width re-lays out the row on every frame, while a
            clip-path animates on the compositor and touches no layout. */}
        <div
          className={`target-bar__fill${hasReached ? ' is-reached' : ''}`}
          style={{ clipPath: `inset(0 ${100 - clamp(current)}% 0 0 round var(--radius-sm))` }}
        />
        {/* The target reads as the same dashed line the trend charts use for
            the same thing, so the card and the charts speak one language. */}
        <div className="target-bar__marker" style={{ left: `${clamp(target)}%` }} />
      </div>

      <p className="target-bar__gap">
        {hasReached
          ? `Cleared — ${gap} ${gapNoun} above the target.`
          : `${gap} ${gapNoun} to go.`}
      </p>
    </div>
  )
}
