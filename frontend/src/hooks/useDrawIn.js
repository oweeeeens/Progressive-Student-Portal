import { useEffect, useState } from 'react'

// Lets a chart draw itself in on first paint.
//
// The bar charts already revealed their fills with a clip-path transition —
// the right technique, since clip-path animates on the compositor instead of
// re-laying out the row on every frame. It simply never fired: the final
// clipPath was set on the very first render, so there was nothing to
// transition from and every chart appeared fully drawn.
//
// This returns false for one frame and true afterwards, so a chart can mount
// collapsed and release immediately. Two frames of requestAnimationFrame
// rather than one: the first is the frame React commits the collapsed value
// in, and the style has to be committed before the change can be animated.
//
// Returns true immediately when the reader has asked for reduced motion, so
// the chart is simply drawn rather than drawn-in. That is a real alternative
// rather than a faster animation, which is what the global reduced-motion
// switch in index.css cannot express on its own.
export function useDrawIn() {
  const [drawn, setDrawn] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (drawn) return undefined
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setDrawn(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [drawn])

  return drawn
}

function prefersReducedMotion() {
  // matchMedia is missing in some test environments; assume motion is fine
  // rather than permanently disabling every chart's entrance.
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
