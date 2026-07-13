// Best-effort detection of a phone/tablet (a device with a real camera),
// used to force proof photos to be captured with the device camera instead of
// a desktop file picker (which is the easy cheating hole). Errs toward "mobile"
// only on clear touch/mobile signals, so laptops — including touchscreen
// laptops, whose primary pointer is a mouse — are treated as desktop.
function detect() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const mobileUA = /Android|iPhone|iPod|Mobile|Silk|Kindle/i.test(ua)
  // iPadOS Safari reports as "MacIntel" but exposes touch points.
  const iPadOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
  const coarseTouch =
    (navigator.maxTouchPoints || 0) > 0 &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  return mobileUA || iPadOS || coarseTouch
}

export const IS_MOBILE = detect()
