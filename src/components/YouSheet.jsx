import { useState } from 'react'
import { VOICES } from '../copy.js'
import Icon from './Icons.jsx'
import Sheet from './Sheet.jsx'
import { ModeCards } from './PostCreateSteps.jsx'

// Personal settings sheet (avatar tap): colorway, voice, and photo privacy.
// Every pick applies live and only affects your own account. Sheet stays open
// for comparison; swipe down or tap the backdrop to dismiss.
export default function YouSheet({
  theme, onPickTheme, tone, onPickTone,
  sharing, onPickSharing, photoReqs = [], onToggleReq, showPrivacy = true,
  email, onSaveEmail, onDeleteAccount, onEditChecklist, onNewChallenge, onExport, onClose,
}) {
  return (
    <Sheet onClose={onClose}>
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 14 }}>Settings</div>

      <div className="set-label"><Icon name="expand" size={13} />Look</div>
      <ModeCards theme={theme} pickTheme={onPickTheme} />

      <div className="set-label"><Icon name="mic" size={13} />Voice</div>
      {VOICES.map((v) => (
        <button key={v.key} className={'theme-opt voice-opt' + (v.key === tone ? ' active' : '')} onClick={() => onPickTone(v.key)}>
          <span className="to-label">{v.label}<small>{v.preview}</small></span>
          {v.key === tone && <span className="to-check"><Icon name="check" size={18} /></span>}
        </button>
      ))}

      {(onEditChecklist || onNewChallenge) && (
        <>
          <div className="set-label"><Icon name="today" size={13} />Challenge</div>
          {onEditChecklist && (
            <button className="theme-opt set-action" onClick={onEditChecklist}>
              <Icon name="edit" size={17} /><span className="to-label">Edit my checklist</span>
              <Icon name="chevron" size={15} className="set-chev" />
            </button>
          )}
          {onNewChallenge && (
            <button className="theme-opt set-action" onClick={onNewChallenge}>
              <Icon name="plus" size={17} /><span className="to-label">Start a new challenge</span>
              <Icon name="chevron" size={15} className="set-chev" />
            </button>
          )}
        </>
      )}

      {onExport && (
        <>
          <div className="set-label"><Icon name="upload" size={13} />My data</div>
          <button className="theme-opt set-action" onClick={onExport}>
            <Icon name="upload" size={17} /><span className="to-label">Export for my doctor</span>
            <Icon name="chevron" size={15} className="set-chev" />
          </button>
        </>
      )}

      {showPrivacy && (
        <PrivacySection sharing={sharing} onPickSharing={onPickSharing}
          photoReqs={photoReqs} onToggleReq={onToggleReq} />
      )}

      {onSaveEmail && <RecoveryEmail email={email} onSave={onSaveEmail} />}
      {onDeleteAccount && <DeleteAccount onDelete={onDeleteAccount} />}
    </Sheet>
  )
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Recovery email: the address a password-reset link is sent to. Existing
// accounts created before this feature can add one here.
function RecoveryEmail({ email, onSave }) {
  const [val, setVal] = useState(email || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const dirty = val.trim().toLowerCase() !== (email || '').toLowerCase()
  async function save() {
    if (!EMAIL_RE.test(val.trim())) { setMsg({ err: true, t: 'Enter a valid email' }); return }
    setBusy(true); setMsg(null)
    try { await onSave(val.trim()); setMsg({ err: false, t: 'Saved' }) }
    catch (e) { setMsg({ err: true, t: e.message }) }
    finally { setBusy(false) }
  }
  return (
    <>
      <div className="set-label"><Icon name="upload" size={13} />Recovery email</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>For a password reset. Never shared.</p>
      <div className="row-split" style={{ gap: 8 }}>
        <input className="fr-input" style={{ flex: 1 }} type="email" inputMode="email" autoCapitalize="none"
          value={val} placeholder="you@example.com" onChange={(e) => { setVal(e.target.value); setMsg(null) }} />
        <button className="btn btn-go btn-sm" disabled={busy || !dirty} onClick={save}>{busy ? '…' : 'Save'}</button>
      </div>
      {msg && <div className={msg.err ? 'login-err' : 'muted'} style={{ textAlign: 'left', fontSize: 12, marginTop: 6 }}>{msg.t}</div>}
    </>
  )
}

// Irreversible — a two-step confirm guards it. On success the app clears the
// session and returns to the login screen, so this component just unmounts.
function DeleteAccount({ onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  return (
    <>
      <div className="set-label"><Icon name="logout" size={13} />Account</div>
      {!confirming ? (
        <button className="theme-opt danger-opt set-action" onClick={() => setConfirming(true)}>
          <Icon name="x" size={17} /><span className="to-label">Delete account</span>
        </button>
      ) : (
        <div className="danger-confirm">
          <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
            This permanently deletes your account, your logged proof, and your goals. It can't be undone.
            Challenges you own pass to a teammate.
          </p>
          {err && <div className="login-err" style={{ textAlign: 'left', marginBottom: 10 }}>{err}</div>}
          <div className="review-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => { setConfirming(false); setErr(null) }}>Keep my account</button>
            <button className="btn btn-danger" disabled={busy} onClick={async () => {
              setBusy(true); setErr(null)
              try { await onDelete() } catch (e) { setErr(e.message); setBusy(false) }
            }}>{busy ? 'Deleting…' : 'Delete forever'}</button>
          </div>
        </div>
      )}
    </>
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
      <div className="set-label"><Icon name="camera" size={13} />Who sees my photos</div>
      <button className={'theme-opt priv-opt set-action' + (cur === 'icons' ? ' active' : '')} onClick={() => onPickSharing('icons')}>
        <Icon name="target" size={17} /><span className="to-label">Just me</span>
        {cur === 'icons' && <span className="to-check"><Icon name="check" size={18} /></span>}
      </button>
      <button className={'theme-opt priv-opt set-action' + (cur === 'all' ? ' active' : '')} onClick={() => onPickSharing('all')}>
        <Icon name="grid" size={17} /><span className="to-label">My challenge</span>
        {cur === 'all' && <span className="to-check"><Icon name="check" size={18} /></span>}
      </button>

      {cur === 'all' && photoReqs.length > 0 && (
        <>
          <div className="set-label"><Icon name="minus" size={13} />Keep some private</div>
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
