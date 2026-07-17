import { useEffect, useState } from 'react'
import Login from './Login.jsx'
import Icon from './Icons.jsx'
import { pinChrome } from '../theme.js'

// Landing for logged-out web visitors (the native app skips this and opens
// straight on auth). Editorial system in the Linen language: huge serif type,
// one idea per section, the product as the visual, almost no words. The voice
// section drops into the sunrise dark for contrast; auth stays sunrise.
export default function Landing({ onAuthed }) {
  const [stage, setStage] = useState('landing')
  const [authMode, setAuthMode] = useState('signup')
  // Live preview: tapping Paper/Ink flips the whole landing between the two
  // experiences so a visitor can feel each before signing up.
  const [mode, setMode] = useState('paper')

  // Landing owns the chrome while logged out; it follows the previewed mode
  // (the auth flow pins its own on mount). applyTheme takes over post-login.
  useEffect(() => {
    if (stage === 'landing') pinChrome(mode === 'ink' ? '#14110D' : '#F2ECDF')
  }, [mode, stage])

  // Scroll-in reveals, Apple style. Reduced-motion users get everything static.
  useEffect(() => {
    if (stage !== 'landing') return
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0.2 },
    )
    document.querySelectorAll('.lp2-io').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [stage])

  const enter = (mode) => {
    setAuthMode(mode)
    setStage('auth')
    window.scrollTo(0, 0)
  }

  if (stage === 'auth') {
    // Login self-wraps in the cream .lin scope now.
    return <Login onAuthed={onAuthed} initialMode={authMode} onBack={() => setStage('landing')} />
  }

  return (
    <div className={'lp2' + (mode === 'ink' ? ' lp2-ink' : '')}>
      <header className="lp2-nav">
        <span className="lp2-brand">
          <img className="lp2-logo" src="/logo-96.png" alt="" />
          <span className="lp2-word">You Mode</span>
        </span>
        <button className="lp2-login" onClick={() => enter('signin')}>Log in</button>
      </header>

      <section className="lp2-hero">
        <h1 className="lp-reveal" style={{ animationDelay: '.1s' }}>Stick to your goals.</h1>
        <p className="lp2-sub lp-reveal" style={{ animationDelay: '.26s' }}>For the goals you've always meant to start but never stuck with, built around you and exactly how you like to track things.</p>
        <div className="lp2-cta-row lp-reveal" style={{ animationDelay: '.4s' }}>
          <button className="lp2-cta" onClick={() => enter('signup')}>Get started</button>
        </div>
        <PhoneMock />
      </section>

      <section className="lp2-dark">
        <div className="lp2-aura" aria-hidden="true"><i /><i /></div>
        <div className="lp2-inner lp2-io">
          <div className="lp2-orb" aria-hidden="true"><Icon name="mic" size={30} /></div>
          <h2>Just talk.</h2>
          <p className="lp2-p">
            Ramble about your goal for ten minutes if you need to. The AI listens,
            asks a question or two, and hands you a challenge that fits your goals and your life.
          </p>
        </div>
      </section>

      <section className="lp2-io">
        <TrackGrid />
        <h2>Custom goal tracking.</h2>
        <p className="lp2-p">
          Some goals you photograph, some you just check off. You decide what done looks like.
        </p>
      </section>

      <section className="lp2-io">
        <h2>Two moods.</h2>
        <p className="lp2-p">Tap one to see the whole page in it.</p>
        <div className="lp2-modes-grid">
          <button type="button" className={'lp2-mode linen' + (mode === 'paper' ? ' active' : '')}
            aria-pressed={mode === 'paper'} onClick={() => setMode('paper')}>
            <b>Paper</b><span>Cream, ink, and serif.</span>
          </button>
          <button type="button" className={'lp2-mode navy' + (mode === 'ink' ? ' active' : '')}
            aria-pressed={mode === 'ink'} onClick={() => setMode('ink')}>
            <b>Noir</b><span>Black, bold, and sharp.</span>
          </button>
        </div>
      </section>

      <section className="lp2-final lp2-io">
        <img className="lp2-final-mark" src="/logo-1024.png" alt="" />
        <h2>Day 1 starts today.</h2>
        <button className="lp2-cta" style={{ marginTop: 18 }} onClick={() => enter('signup')}>Get started</button>
      </section>

      <footer className="lp2-foot">
        You Mode · <a href="/privacy.html">Privacy</a> · © 2026
      </footer>
    </div>
  )
}

// A little Linen "Today" screen inside a phone frame — the product is the hero.
function PhoneMock() {
  const c = 2 * Math.PI * 46
  return (
    <div className="lpm lp-reveal" style={{ animationDelay: '.55s' }} aria-hidden="true">
      <div className="lpm-frame">
        <div className="lpm-screen">
          <div className="lpm-date">Today · Day 15</div>
          <svg width="128" height="128" className="ring lpm-ring">
            <circle cx="64" cy="64" r="46" fill="none" strokeWidth="7" stroke="var(--lpc-line)" />
            <circle cx="64" cy="64" r="46" fill="none" strokeWidth="7" stroke="#C15A34" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c / 3} />
            <text x="64" y="62" textAnchor="middle" className="lpm-day" transform="rotate(90 64 64)">Day 15</text>
            <text x="64" y="80" textAnchor="middle" className="lpm-count" transform="rotate(90 64 64)">2 OF 3</text>
          </svg>
          <div className="lpm-line">One to go. The day is almost yours.</div>
          <div className="lpm-tile">
            <Icon name="dumbbell" size={15} />Workout
            <span className="lpm-check"><Icon name="check" size={11} strokeWidth={3} /></span>
          </div>
          <div className="lpm-tile">
            <Icon name="drop" size={15} />Hydrate
            <span className="lpm-check"><Icon name="check" size={11} strokeWidth={3} /></span>
          </div>
          <div className="lpm-tile todo">
            <Icon name="book" size={15} />Read 10 pages
            <span className="lpm-check" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Three ways a finished goal can look — photo proof, a simple check, a written
// note. Shows (not tells) that tracking bends to the goal, not the reverse.
function TrackGrid() {
  const Done = () => (
    <span className="tg-done"><Icon name="check" size={10} strokeWidth={3} /></span>
  )
  return (
    <div className="lp2-tg lp2-io" aria-hidden="true">
      <figure className="tg-card">
        <div className="tg-media tg-photo">
          <span className="tg-cam"><Icon name="camera" size={19} /></span>
          <Done />
        </div>
        <figcaption>The run, photographed</figcaption>
      </figure>
      <figure className="tg-card">
        <div className="tg-media tg-check">
          <Icon name="check" size={30} strokeWidth={2.5} />
        </div>
        <figcaption>Read 10 pages, checked off</figcaption>
      </figure>
      <figure className="tg-card">
        <div className="tg-media tg-meal">
          <Icon name="meal" size={25} />
          <Done />
        </div>
        <figcaption>Today's meals, logged</figcaption>
      </figure>
    </div>
  )
}
