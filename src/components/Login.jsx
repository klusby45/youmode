import { useEffect, useState } from 'react'
import * as api from '../data.js'
import { USERNAME_RE } from '../config.js'
import { pinChrome } from '../theme.js'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// The cream first-run auth flow. Signup is staged FRQNCY-style: one question
// per screen with progress dots and a greeting beat; login and forgot stay
// single screens. Fixed copy — the voice system is in-app only. Same props
// contract as always: { onAuthed, initialMode, onBack }.
export default function Login({ onAuthed, initialMode = 'signin', onBack }) {
  const [mode, setMode] = useState(initialMode) // signin | signup | forgot
  const [step, setStep] = useState(0) // signup: 0 name, 1 email, 2 password
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(false)

  useEffect(() => { pinChrome('#F2ECDF') }, []) // covers the native mount too

  const uname = username.trim().toLowerCase()
  const name = uname ? cap(uname) : ''
  const flip = (m) => { setMode(m); setStep(0); setErr(null); setSent(false) }

  // Back resolves per state: mid-signup steps go back a step; the first signup
  // step returns to signin (or the landing); signin/forgot go where you'd expect.
  const back = mode === 'signup'
    ? (step > 0
      ? () => { setErr(null); setStep(step - 1) }
      : (initialMode === 'signin' ? () => flip('signin') : onBack))
    : mode === 'forgot'
      ? () => flip('signin')
      : onBack

  async function nextFromUsername(e) {
    e.preventDefault()
    if (busy) return
    if (!USERNAME_RE.test(uname)) return setErr('Usernames are 3 to 20 characters: lowercase letters, numbers, or _')
    setBusy(true); setErr(null)
    const taken = await api.usernameTaken(uname)
    setBusy(false)
    if (taken) return setErr('That username is taken. Try another.')
    setStep(1)
  }

  function nextFromEmail(e) {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setErr("That email doesn't look right. Check it once more.")
    setErr(null)
    setStep(2)
  }

  async function submitSignup(e) {
    e.preventDefault()
    if (busy) return
    if (password.length < 6) return setErr('Passwords need at least 6 characters')
    setBusy(true); setErr(null)
    try {
      const uid = await api.signUp({ username: uname, password, email: email.trim(), phone: null })
      await onAuthed(uid) // unmounts on success; busy stays true intentionally
    } catch (e2) {
      setErr(e2.message || 'Something went wrong')
      setBusy(false)
    }
  }

  async function submitSignin(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const uid = await api.signIn(username, password)
      await onAuthed(uid)
    } catch (e2) {
      setErr(/invalid login/i.test(e2.message || '') ? 'Wrong username or password' : (e2.message || 'Something went wrong'))
      setBusy(false)
    }
  }

  async function submitForgot(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      await api.requestReset(username.trim())
      setSent(true)
    } catch (e2) {
      setErr(e2.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lin">
      <div className="lin-bg" />
      <div className="au-wrap">
        <header className="au-top">
          {back && <button className="au-back" onClick={back}>Back</button>}
          <span className="au-brand">
            <img className="au-logo" src="/logo-96.png" alt="" />
            <span className="au-word">You Mode</span>
          </span>
        </header>

        {mode === 'signup' && (
          <div className="onb-dots" aria-hidden="true">
            {[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}
          </div>
        )}

        {/* key remounts the step container so the entrance animation replays */}
        <div className="au-step" key={mode + step}>
          {mode === 'signup' && step === 0 && (
            <form onSubmit={nextFromUsername}>
              <h2 className="au-q">What should we call you?</h2>
              <p className="au-sub">Pick a username. It's how you'll sign in.</p>
              <div className="field">
                <input type="text" autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off"
                  spellCheck="false" inputMode="text" value={username} placeholder="e.g. sarah"
                  onChange={(e) => { setUsername(e.target.value); setErr(null) }} />
              </div>
              {err && <div className="login-err">{err}</div>}
              <button className="btn btn-accent btn-block" disabled={busy || !username.trim()} type="submit">
                {busy ? 'Checking…' : 'Continue'}
              </button>
              <button className="auth-flip" type="button" onClick={() => flip('signin')}>Already have an account? Sign in</button>
            </form>
          )}

          {mode === 'signup' && step === 1 && (
            <form onSubmit={nextFromEmail}>
              <p className="au-greet">Nice to meet you, {name}.</p>
              <h2 className="au-q">Where can we reach you?</h2>
              <p className="au-sub">Your email is only for password recovery. No newsletters, no noise.</p>
              <div className="field">
                <input type="email" autoFocus autoComplete="email" autoCapitalize="none" autoCorrect="off"
                  spellCheck="false" inputMode="email" value={email} placeholder="you@example.com"
                  onChange={(e) => { setEmail(e.target.value); setErr(null) }} />
              </div>
              {err && <div className="login-err">{err}</div>}
              <button className="btn btn-accent btn-block" disabled={!email.trim()} type="submit">Continue</button>
            </form>
          )}

          {mode === 'signup' && step === 2 && (
            <form onSubmit={submitSignup}>
              <p className="au-greet">Last thing, {name}.</p>
              <h2 className="au-q">Set a password.</h2>
              <p className="au-sub">At least 6 characters. Then we build your challenge.</p>
              {/* hidden username keeps password managers associating the pair */}
              <input className="au-ghost" type="text" name="username" value={uname} readOnly
                autoComplete="username" tabIndex={-1} aria-hidden="true" />
              <div className="field">
                <input type="password" autoFocus autoComplete="new-password" value={password}
                  placeholder="••••••••" onChange={(e) => { setPassword(e.target.value); setErr(null) }} />
              </div>
              {err && <div className="login-err">{err}</div>}
              <button className="btn btn-accent btn-block" disabled={busy || !password} type="submit">
                {busy ? 'One sec…' : 'Create my account'}
              </button>
              <div className="login-note">Your email stays private. It's only used for your account.</div>
            </form>
          )}

          {mode === 'signin' && (
            <form onSubmit={submitSignin}>
              <h2 className="au-q">Welcome back.</h2>
              <p className="au-sub">Sign in and pick up where you left off.</p>
              <div className="field">
                <label>Username</label>
                <input type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck="false"
                  value={username} placeholder="your username" onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" autoComplete="current-password" value={password}
                  placeholder="••••••••" onChange={(e) => setPassword(e.target.value)} />
              </div>
              {err && <div className="login-err">{err}</div>}
              <button className="btn btn-accent btn-block" disabled={busy || !username || !password} type="submit">
                {busy ? 'One sec…' : 'Sign in'}
              </button>
              <button className="auth-flip" type="button" onClick={() => flip('forgot')}>Forgot password?</button>
              <button className="auth-flip" type="button" onClick={() => flip('signup')}>New here? Create an account</button>
            </form>
          )}

          {mode === 'forgot' && (
            sent ? (
              <>
                <h2 className="au-q">Check your inbox.</h2>
                <p className="au-sub">
                  If an account matches that username, a reset link is on its way.
                  Check your inbox and spam. It works for 15 minutes.
                </p>
                <button className="auth-flip" type="button" onClick={() => flip('signin')}>Back to sign in</button>
              </>
            ) : (
              <form onSubmit={submitForgot}>
                <h2 className="au-q">Let's get you back in.</h2>
                <p className="au-sub">Tell us your username and we'll email a reset link to the address on file.</p>
                <div className="field">
                  <input type="text" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck="false"
                    value={username} placeholder="your username" onChange={(e) => setUsername(e.target.value)} />
                </div>
                {err && <div className="login-err">{err}</div>}
                <button className="btn btn-accent btn-block" disabled={busy || !username} type="submit">
                  {busy ? 'Sending…' : 'Email me a reset link'}
                </button>
              </form>
            )
          )}
        </div>
      </div>
    </div>
  )
}
