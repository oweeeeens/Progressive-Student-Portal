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
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width
      if (measured) setWidth(measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
