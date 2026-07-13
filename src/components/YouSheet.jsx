import { useState } from 'react'
import { THEMES } from '../theme.js'
import { VOICES } from '../copy.js'
import Icon from './Icons.jsx'
import Sheet from './Sheet.jsx'

// Personal settings sheet (avatar tap): colorway, voice, and photo privacy.
// Every pick applies live and only affects your own account. Sheet stays open
// for comparison; swipe down or tap the backdrop to dismiss.
export default function YouSheet({
  theme, onPickTheme, tone, onPickTone,
  sharing, onPickSharing, photoReqs = [], onToggleReq, showPrivacy = true, onClose,
}) {
  return (
    <Sheet onClose={onClose}>
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>You</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 14px' }}>
        Your picks, your eyes only — everyone chooses their own.
      </p>

      <div className="section-label" style={{ marginTop: 0 }}>Colorway</div>
      {THEMES.map((t) => (
        <button key={t.key} className={'theme-opt' + (t.key === theme ? ' active' : '')} onClick={() => onPickTheme(t.key)}>
          <span className="theme-swatch" style={{ background: t.swatch.bg }}>
            <i style={{ background: t.swatch.a }} />
            <i style={{ background: t.swatch.b }} />
          </span>
          <span className="to-label">{t.label}</span>
          {t.key === theme && <span className="to-check"><Icon name="check" size={18} /></span>}
        </button>
      ))}

      <div className="section-label">Voice</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        How the app talks to you — from gentle to no-excuses.
      </p>
      {VOICES.map((v) => (
        <button key={v.key} className={'theme-opt voice-opt' + (v.key === tone ? ' active' : '')} onClick={() => onPickTone(v.key)}>
          <span className="to-label">
            {v.label}
            <small>{v.preview}</small>
          </span>
          {v.key === tone && <span className="to-check"><Icon name="check" size={18} /></span>}
        </button>
      ))}

      {showPrivacy && (
        <PrivacySection sharing={sharing} onPickSharing={onPickSharing}
          photoReqs={photoReqs} onToggleReq={onToggleReq} />
      )}
    </Sheet>
  )
}

function PrivacySection({ sharing, onPickSharing, photoReqs, onToggleReq }) {
  const cur = sharing || 'icons'
  // Local optimistic mirror so a lock flips instantly, before the refresh.
  const [local, setLocal] = useState({})
  const [busyId, setBusyId] = useState(null)
  const isLocked = (r) => (r.id in local ? local[r.id] : r.isPrivate)

  async function toggle(r) {
    const next = !isLocked(r)
    setLocal((m) => ({ ...m, [r.id]: next }))
    setBusyId(r.id)
    try { await onToggleReq(r.id, next) } catch { setLocal((m) => ({ ...m, [r.id]: !next })) } finally { setBusyId(null) }
  }

  return (
    <>
      <div className="section-label">Proof photos</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        Who sees your actual photos when they open your day. Your referee always sees them.
      </p>
      <button className={'theme-opt priv-opt' + (cur === 'icons' ? ' active' : '')} onClick={() => onPickSharing('icons')}>
        <span className="to-label">Icons only<small>Others see your progress icons + captions, not the photos</small></span>
        {cur === 'icons' && <span className="to-check"><Icon name="check" size={18} /></span>}
      </button>
      <button className={'theme-opt priv-opt' + (cur === 'all' ? ' active' : '')} onClick={() => onPickSharing('all')}>
        <span className="to-label">Everyone in your challenges<small>Challenge-mates can open your proof photos</small></span>
        {cur === 'all' && <span className="to-check"><Icon name="check" size={18} /></span>}
      </button>

      {cur === 'all' && photoReqs.length > 0 && (
        <>
          <div className="section-label">Keep private</div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            Lock any item to keep it icon + caption only — like a progress photo.
          </p>
          {photoReqs.map((r) => {
            const on = isLocked(r)
            return (
              <button key={r.id} className={'theme-opt lock-opt' + (on ? ' active' : '')} onClick={() => toggle(r)} disabled={busyId === r.id}>
                <span className="to-label" style={{ textTransform: 'none', letterSpacing: 0 }}>{r.label}</span>
                <span className={'lock-pill' + (on ? ' on' : '')}>
                  <Icon name={on ? 'check' : 'camera'} size={12} />{on ? 'Private' : 'Shared'}
                </span>
              </button>
            )
          })}
        </>
      )}
    </>
  )
}
