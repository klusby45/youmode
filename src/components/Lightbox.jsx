import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icons.jsx'
import ProofImage from './ProofImage.jsx'

// Full-screen photo viewer: pinch to zoom, drag to pan (when zoomed),
// double-tap to toggle zoom, swipe down (unzoomed) or ✕ to close.
export default function Lightbox({ path, label, caption, stats, onClose }) {
  const tRef = useRef({ s: 1, x: 0, y: 0 })
  const dragRef = useRef(0)
  const [, force] = useState(0)
  const ptrs = useRef(new Map())
  const g = useRef(null)
  const lastTap = useRef(0)
  const moved = useRef(false)

  const render = () => force((v) => v + 1)
  const setT = (t) => { tRef.current = t; render() }
  const setDrag = (d) => { dragRef.current = d; render() }
  const pinchDist = () => {
    const [a, b] = [...ptrs.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y) || 1
  }

  function down(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
    const t = tRef.current
    if (ptrs.current.size === 2) {
      g.current = { mode: 'pinch', d0: pinchDist(), s0: t.s, x0: t.x, y0: t.y }
    } else {
      g.current = { mode: t.s > 1 ? 'pan' : 'swipe', px: e.clientX, py: e.clientY, x0: t.x, y0: t.y }
    }
  }

  function move(e) {
    if (!ptrs.current.has(e.pointerId)) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const G = g.current
    if (!G) return
    if (G.mode === 'pinch' && ptrs.current.size === 2) {
      const s = Math.min(5, Math.max(1, G.s0 * (pinchDist() / G.d0)))
      moved.current = true
      setT({ s, x: G.x0, y: G.y0 })
    } else if (G.mode === 'pan') {
      const dx = e.clientX - G.px
      const dy = e.clientY - G.py
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true
      setT({ s: tRef.current.s, x: G.x0 + dx, y: G.y0 + dy })
    } else if (G.mode === 'swipe') {
      const dy = e.clientY - G.py
      if (Math.abs(dy) > 4) moved.current = true
      setDrag(Math.max(0, dy))
    }
  }

  function up(e) {
    ptrs.current.delete(e.pointerId)
    const G = g.current
    if (G?.mode === 'swipe' && ptrs.current.size === 0) {
      if (dragRef.current > 110) return onClose()
      setDrag(0)
      if (!moved.current) {
        const now = Date.now()
        if (now - lastTap.current < 320) {
          const t = tRef.current
          setT(t.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 })
          lastTap.current = 0
        } else {
          lastTap.current = now
        }
      }
    }
    if (ptrs.current.size === 0) {
      if (tRef.current.s <= 1.05) setT({ s: 1, x: 0, y: 0 })
      g.current = null
    } else if (ptrs.current.size === 1 && G?.mode === 'pinch') {
      // one finger lifted mid-pinch → seamless hand-off to pan
      const [p] = [...ptrs.current.values()]
      g.current = { mode: 'pan', px: p.x, py: p.y, x0: tRef.current.x, y0: tRef.current.y }
    }
  }

  const { s, x, y } = tRef.current
  const drag = dragRef.current
  // Portal to <body>: the sheet's swipe-dismiss transform would otherwise
  // hijack position:fixed and anchor the viewer to the sheet's scroll content.
  return createPortal(
    <div className="lightbox" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <button className="lb-close" onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>
      <div
        className="lb-img"
        style={{
          transform: `translate(${x}px, ${y + drag}px) scale(${s})`,
          transition: g.current ? 'none' : 'transform .2s ease',
          opacity: drag ? Math.max(0.4, 1 - drag / 500) : 1,
        }}
      >
        <ProofImage path={path} alt={label} />
      </div>
      {/* What the app already estimated for this plate. It was on the Today
          tile the day it was logged and then only reachable as a total, so a
          photo you tap weeks later could not tell you what was in it. Hidden
          while zoomed, since then you are looking at the food. */}
      {stats?.length > 0 && s <= 1.02 && (
        <div className="lb-stats">
          {caption && <div className="lbs-cap">{caption}</div>}
          <div className="lbs-grid">
            {stats.map(([k, v]) => (
              <div key={k} className="lbs-item"><b>{v}</b><span>{k}</span></div>
            ))}
          </div>
          <div className="lbs-note">estimated from the photo and your description</div>
        </div>
      )}
      {label && <div className="lb-cap">{label} · pinch or double-tap to zoom</div>}
    </div>,
    document.body
  )
}
