import { useState } from 'react'
import * as api from '../data.js'

// Landing target for the emailed reset link (youmode.app/reset?token=...).
// Standalone + sunrise-styled; shown regardless of auth state.
export default function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (password.length < 6) return setErr('Password: at least 6 characters')
    if (password !== confirm) return setErr('Those passwords don’t match')
    setBusy(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <div className="sun-scope">
      <div className="sun-bg" />
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-brand">
            <div className="lb-mark">YOU</div>
            <div className="lb-word">MODE</div>
            <div className="lb-sub">{done ? 'Password updated' : 'Set a new password'}</div>
          </div>
          {done ? (
            <>
              <p className="center muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
                You're all set. Sign in with your new password.
              </p>
              <button className="btn btn-accent btn-block" style={{ marginTop: 14 }} onClick={onDone}>Sign in</button>
            </>
          ) : (
            <form onSubmit={submit}>
              <div className="field">
                <label>New password</label>
                <input type="password" autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="field">
                <label>Confirm password</label>
                <input type="password" autoComplete="new-password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
              </div>
              {err && <div className="login-err">{err}</div>}
              <button className="btn btn-accent btn-block" disabled={busy || !password} type="submit">
                {busy ? 'Saving…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
