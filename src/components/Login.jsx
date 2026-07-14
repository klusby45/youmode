import { useState } from 'react'
import * as api from '../data.js'
import { USERNAME_RE, normalizePhone } from '../config.js'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Fixed copy — the voice system is in-app only; logged-out surfaces speak in
// the warm brand register.
export default function Login({ onAuthed, initialMode = 'signin', onBack }) {
  const [mode, setMode] = useState(initialMode) // signin | signup | forgot
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'forgot') {
        await api.requestReset(username.trim())
        setSent(true)
        setBusy(false)
        return
      }
      let uid
      if (mode === 'signup') {
        const uname = username.trim().toLowerCase()
        if (!USERNAME_RE.test(uname)) throw new Error('Username: 3–20 letters, numbers, or _')
        if (!EMAIL_RE.test(email.trim())) throw new Error('Enter a valid email so you can reset your password later')
        const normPhone = normalizePhone(phone)
        if (!normPhone) throw new Error('Enter a valid cell number')
        if (password.length < 6) throw new Error('Password: at least 6 characters')
        uid = await api.signUp({ username: uname, phone: normPhone, password, email: email.trim() })
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
  const forgot = mode === 'forgot'

  if (forgot) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <button className="lb-back" onClick={() => { setMode('signin'); setErr(null); setSent(false) }}>← Back to sign in</button>
          <div className="login-brand">
            <div className="lb-mark">YOU</div>
            <div className="lb-word">MODE</div>
            <div className="lb-sub">Reset your password</div>
          </div>
          {sent ? (
            <p className="center muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              If an account matches that username, we just emailed a reset link to the address on file.
              Check your inbox (and spam). The link works for 15 minutes.
            </p>
          ) : (
            <form onSubmit={submit}>
              <div className="field">
                <label>Your username</label>
                <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck="false"
                  value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your username" />
              </div>
              {err && <div className="login-err">{err}</div>}
              <button className="btn btn-accent btn-block" disabled={busy || !username} type="submit">
                {busy ? 'Sending…' : 'Email me a reset link'}
              </button>
              <div className="login-note">We send the link to the email you signed up with.</div>
            </form>
          )}
        </div>
      </div>
    )
  }

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
              <label>Email</label>
              <input type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck="false" inputMode="email"
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          )}
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
          <button className="btn btn-accent btn-block" disabled={busy || !username || !password || (signup && (!phone || !email))} type="submit">
            {busy ? 'One sec…' : signup ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {!signup && (
          <button className="auth-flip" onClick={() => { setMode('forgot'); setErr(null); setSent(false) }}>Forgot password?</button>
        )}
        <button className="auth-flip" onClick={() => { setMode(signup ? 'signin' : 'signup'); setErr(null) }}>
          {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>

        <div className="login-note">{signup ? 'Your email and number are private, used only for your account.' : 'your days · your rules · your people'}</div>
      </div>
    </div>
  )
}
