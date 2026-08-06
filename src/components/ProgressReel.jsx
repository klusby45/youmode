import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import Icon from './Icons.jsx'
import Sheet from './Sheet.jsx'
import ProofImage from './ProofImage.jsx'

// Every progress photo you have taken, in order, with the first and the most
// recent side by side.
//
// The photos were already in the app, one day at a time, which is exactly the
// view that hides the change: nobody notices themselves on a Tuesday. Put day
// one next to today and the whole run is the point.
//
// The collage is drawn on a canvas so it can leave as a single image, because
// the thing people want to do with this is show someone.

const GAP = 14
const PAD = 34
const LABEL = 46

export default function ProgressReel({ shots, name, onClose }) {
  const { actions } = useApp()
  const [i, setI] = useState(shots.length - 1) // which shot is the "after"
  const [busy, setBusy] = useState(null)       // 'building' | 'done' | error string
  const stripRef = useRef(null)

  const first = shots[0]
  const after = shots[i] || first
  const span = after.day - first.day

  // Keep the selected thumbnail in view when it changes from the arrows.
  useEffect(() => {
    const el = stripRef.current?.querySelector('.pr-thumb.on')
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [i])

  const title = useMemo(
    () => (span > 0 ? `${span} days between these` : 'your first one'),
    [span])

  // Grid that stays close to square, so a 4-shot run and a 60-shot run both
  // come out looking deliberate.
  async function buildCollage() {
    setBusy('building')
    try {
      const picks = pickEven(shots, 12)
      const urls = await Promise.all(picks.map((s) => actions.signedUrl(s.path)))
      const imgs = await Promise.all(urls.map(loadImage))
      const cols = Math.ceil(Math.sqrt(imgs.length))
      const rows = Math.ceil(imgs.length / cols)
      const cell = 460
      const w = PAD * 2 + cols * cell + (cols - 1) * GAP
      const h = PAD * 2 + rows * (cell + LABEL) + (rows - 1) * GAP + 74

      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const x = c.getContext('2d')
      x.fillStyle = '#12100e'; x.fillRect(0, 0, w, h)

      imgs.forEach((img, n) => {
        const cx = PAD + (n % cols) * (cell + GAP)
        const cy = PAD + Math.floor(n / cols) * (cell + LABEL + GAP)
        drawCover(x, img, cx, cy, cell, cell)
        x.fillStyle = '#e8e2d9'
        x.font = '600 26px ui-sans-serif, system-ui, sans-serif'
        x.textAlign = 'center'
        x.fillText(`Day ${picks[n].day}`, cx + cell / 2, cy + cell + 32)
      })

      x.fillStyle = '#8c8378'
      x.font = '500 24px ui-sans-serif, system-ui, sans-serif'
      x.textAlign = 'center'
      x.fillText(`${name} · day ${first.day} to day ${shots[shots.length - 1].day}`, w / 2, h - 30)

      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9))
      const file = new File([blob], 'progress.jpg', { type: 'image/jpeg' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My progress' })
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'progress.jpg'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      }
      setBusy('done')
    } catch (e) {
      // A share the user backed out of is not a failure worth shouting about.
      setBusy(/abort/i.test(e?.name || e?.message || '') ? null : "Couldn't build that. Try again.")
    }
  }

  return (
    <Sheet onClose={onClose}>
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 2 }}>Your progress</div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
        {shots.length} photo{shots.length === 1 ? '' : 's'} · {title}
      </p>

      <div className="pr-pair">
        <figure>
          <ProofImage path={first.path} alt={`Day ${first.day}`} />
          <figcaption>Day {first.day}</figcaption>
        </figure>
        <figure>
          <ProofImage path={after.path} alt={`Day ${after.day}`} />
          <figcaption>Day {after.day}</figcaption>
        </figure>
      </div>

      {shots.length > 1 && (
        <>
          <div className="pr-strip" ref={stripRef}>
            {shots.map((s, n) => (
              <button key={s.path} className={'pr-thumb' + (n === i ? ' on' : '')}
                onClick={() => setI(n)} aria-label={`Day ${s.day}`}>
                <ProofImage path={s.path} alt={`Day ${s.day}`} />
                <span>{s.day}</span>
              </button>
            ))}
          </div>
          <div className="pr-scrub">
            <button className="iconbtn" disabled={i === 0} onClick={() => setI((v) => Math.max(0, v - 1))} aria-label="Earlier">
              <Icon name="chevron" size={16} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <input type="range" min={0} max={shots.length - 1} value={i}
              aria-label="Scrub through your photos"
              onChange={(e) => setI(Number(e.target.value))} />
            <button className="iconbtn" disabled={i === shots.length - 1} onClick={() => setI((v) => Math.min(shots.length - 1, v + 1))} aria-label="Later">
              <Icon name="chevron" size={16} />
            </button>
          </div>
        </>
      )}

      <button className="btn btn-accent" style={{ width: '100%', marginTop: 16 }}
        disabled={busy === 'building'} onClick={buildCollage}>
        {busy === 'building' ? 'Building…' : 'Save or share a collage'}
      </button>
      {typeof busy === 'string' && busy !== 'building' && busy !== 'done' && (
        <div className="login-err" style={{ textAlign: 'left', marginTop: 10 }}>{busy}</div>
      )}
      <p className="muted" style={{ fontSize: 12, margin: '10px 2px 0', lineHeight: 1.5 }}>
        The collage is made on your phone and only leaves if you send it.
      </p>

      <button className="auth-flip" onClick={onClose}>Close</button>
    </Sheet>
  )
}

// Evenly spaced across the whole run, always keeping the first and the last:
// the two that carry the story.
function pickEven(list, max) {
  if (list.length <= max) return list
  const out = []
  for (let n = 0; n < max; n++) out.push(list[Math.round((n * (list.length - 1)) / (max - 1))])
  return [...new Set(out)]
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // signed URLs; needed or the canvas taints
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('image failed'))
    img.src = url
  })
}

// Fill the square without squashing anyone.
function drawCover(x, img, dx, dy, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height)
  const sw = dw / scale
  const sh = dh / scale
  x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, dx, dy, dw, dh)
}
