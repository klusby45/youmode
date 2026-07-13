import { useEffect, useRef, useState } from 'react'

// Bottom sheet with native-feeling behavior:
//  • locks the page behind it (no scroll bleed / stuck states on iOS)
//  • swipe-down to dismiss when the sheet is scrolled to its top
//  • tap backdrop to close
// position: 'bottom' (default sheet) | 'top' — use 'top' for anything with a
// text input, so the iOS keyboard can't cover it.
export default function Sheet({ onClose, children, position = 'bottom' }) {
  const ref = useRef(null)
  const [drag, setDrag] = useState(0)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Body scroll lock (position:fixed is the only reliable technique on iOS).
  useEffect(() => {
    const y = window.scrollY
    const s = document.body.style
    const prev = { position: s.position, top: s.top, left: s.left, right: s.right, width: s.width }
    s.position = 'fixed'
    s.top = `-${y}px`
    s.left = '0'
    s.right = '0'
    s.width = '100%'
    return () => {
      s.position = prev.position
      s.top = prev.top
      s.left = prev.left
      s.right = prev.right
      s.width = prev.width
      window.scrollTo(0, y)
    }
  }, [])

  // Swipe-down to dismiss — engages only when the sheet's own scroll is at
  // the top and the gesture is downward; otherwise native scrolling wins.
  // (Bottom sheets only; top dialogs close via Cancel/backdrop.)
  useEffect(() => {
    const el = ref.current
    if (!el || position === 'top') return
    let startY = null
    let dy = 0
    const onStart = (e) => {
      startY = el.scrollTop <= 0 ? e.touches[0].clientY : null
      dy = 0
    }
    const onMove = (e) => {
      if (startY == null) return
      dy = e.touches[0].clientY - startY
      if (dy > 0) {
        e.preventDefault() // stop the rubber-band; we own this gesture
        setDrag(dy * 0.7)
      } else {
        startY = null
        setDrag(0)
      }
    }
    const onEnd = () => {
      if (startY != null && dy > 110) onCloseRef.current()
      else setDrag(0)
      startY = null
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return (
    <div className={'modal-backdrop' + (position === 'top' ? ' top' : '')} onClick={onClose}>
      <div
        ref={ref}
        className="modal"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: drag ? 'none' : 'transform .25s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        {position !== 'top' && <div className="modal-grip" />}
        {children}
      </div>
    </div>
  )
}
