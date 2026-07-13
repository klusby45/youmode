import { useState } from 'react'
import * as api from '../data.js'
import { USERNAME_RE, normalizePhone } from '../config.js'

// Fixed copy — the voice system is in-app only; logged-out surfaces speak in
// the warm brand register.
export default function Login({ onAuthed, initialMode = 'signin', onBack }) {
  const [mode, setMode] = useState(initialMode) // signin | signup
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      let uid
      if (mode === 'signup') {
        const uname = username.trim().toLowerCase()
        if (!USERNAME_RE.test(uname)) throw new Error('Username: 3–20 letters, numbers, or _')
        const normPhone = normalizePhone(phone)
        if (!normPhone) throw new Error('Enter a valid cell number')
        if (password.length < 6) throw new Error('Password: at least 6 characters')
        uid = await api.signUp({ username: uname, phone: normPhone, password })
      } else {
        uid = await api.signIn(username, password)
      }
      await onAuthed(uid)
    } catch (e2) {
      setErr(/invalid login/i.test(e2.message || '') ? 'Wrong username or password' : (e2.message || 'Something went wrong'))
      setBusy(false)
    }
  }

  const signup = mode === 'signup'
  return (
    <div className="login-wrap">
      <div className="login-card">
        {onBack && <button className="lb-back" onClick={onBack}>← Back</button>}
        <div className="login-brand">
          <div className="lb-mark">YOU</div>
          <div className="lb-word">MODE</div>
          <div className="lb-sub">Your challenge. Your rules. Your pace.</div>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label>{signup ? 'Pick a username' : 'Username'}</label>
            <input type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck="false"
              value={username} onChange={(e) => setUsername(e.target.value)} placeholder={signup ? 'e.g. sarah' : 'your username'} />
          </div>
          {signup && (
            <div className="field">
              <label>Cell number</label>
              <input type="tel" autoComplete="tel" inputMode="tel"
                value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
            </div>
          )}
          <div className="field">
            <label>Password</label>
            <input type="password" autoComplete={signup ? 'new-password' : 'current-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {err && <div className="login-err">{err}</div>}
          <button className="btn btn-accent btn-block" disabled={busy || !username || !password || (signup && !phone)} type="submit">
            {busy ? 'One sec…' : signup ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <button className="auth-flip" onClick={() => { setMode(signup ? 'signin' : 'signup'); setErr(null) }}>
          {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>

        <div className="login-note">{signup ? 'Your number stays private. Challenge updates only, no spam.' : 'your days · your rules · your people'}</div>
      </div>
    </div>
  )
}
