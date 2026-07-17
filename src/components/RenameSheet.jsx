import { useState } from 'react'
import Sheet from './Sheet.jsx'

// Owner-only challenge rename, shared by the app header and Standings.
// Top-anchored so the keyboard can't cover it.
export default function RenameSheet({ current, onSave, onClose }) {
  const [name, setName] = useState(current || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = () => {
    if (!name.trim() || busy) return
    setBusy(true); setErr(null)
    onSave(name).catch((e) => { setErr(e.message); setBusy(false) })
  }
  return (
    <Sheet onClose={onClose} position="top">
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>Rename challenge</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        Shows in the top bar and standings. Only you (the owner) can change it.
      </p>
      <input className="fr-input" style={{ width: '100%' }} autoFocus value={name} maxLength={60}
        placeholder="e.g. 75 Hard" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      {err && <div className="login-err" style={{ textAlign: 'left' }}>{err}</div>}
      <div className="review-actions" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-go" disabled={busy || !name.trim()} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  )
}
