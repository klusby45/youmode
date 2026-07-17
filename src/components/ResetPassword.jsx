import { useEffect, useState } from 'react'
import * as api from '../data.js'
import { pinChrome } from '../theme.js'

// Landing target for the emailed reset link (youmode.app/reset?token=...).
// Standalone, cream first-run styling; shown regardless of auth state.
export default function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  useEffect(() => { pinChrome('#F2ECDF') }, [])

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (password.length < 6) return setErr('Passwords need at least 6 characters')
    if (password !== confirm) return setErr("Those passwords don't match")
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
    <div className="lin">
      <div className="lin-bg" />
      <div className="au-wrap">
        <header className="au-top">
          <span className="au-brand">
            <img className="au-logo" src="/logo-96.png" alt="" />
            <span className="au-word">You Mode</span>
          </span>
        </header>
        <div className="au-step">
          {done ? (
            <>
              <h2 className="au-q">Password updated.</h2>
              <p className="au-sub">You're all set. Sign in with your new password.</p>
              <button className="btn btn-accent btn-block" onClick={onDone}>Sign in</button>
            </>
          ) : (
            <form onSubmit={submit}>
              <h2 className="au-q">Set a new password.</h2>
              <p className="au-sub">At least 6 characters. You'll use it from now on.</p>
              <div className="field">
                <label>New password</label>
                <input type="password" autoComplete="new-password" autoFocus value={password}
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
