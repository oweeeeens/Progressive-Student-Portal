import { useLayoutEffect, useRef, useState } from 'react'

// Measures a container's actual rendered CSS pixel width via ResizeObserver,
// so an SVG chart can set its viewBox 1:1 with real pixels instead of an
// arbitrary fixed unit count. Without this, an SVG sized only by viewBox
// scales EVERYTHING inside it — marks and text alike — by however much the
// browser has to stretch that fixed coordinate system to fill the actual
// container width, which is what made every chart on the Analytics page
// render with oversized, inconsistent typography depending on how wide its
// card happened to be. With viewBox width === measured width, that scale
// factor is always 1, so a 13px label renders at 13px everywhere.
export function useChartWidth(fallback = 400) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // Measure once, synchronously, before the observer has had a chance to
    // fire. ResizeObserver delivers its first entry after paint, so without
    // this the first frame rendered at the `fallback` width — a 480-wide
    // viewBox inside a ~266px box on a phone, which the default
    // preserveAspectRatio then scales down to about 55%, text and all. The
    // result was a visible flash of a tiny chart on every load, worst on
    // exactly the screens where the chart was already hardest to read.
    const initial = el.getBoundingClientRect().width
    if (initial) setWidth(initial)

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width
      if (measured) setWidth(measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
