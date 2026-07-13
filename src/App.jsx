import { useEffect, useMemo, useState, useCallback } from 'react'
import * as api from './data.js'
import { todayInTz, currentDayNumber, summarize, deriveFormat } from './lib/challenge.js'
import { getStoredTheme, applyTheme, normalizeTheme, mapAccent } from './theme.js'
import { copyFor, getStoredTone, storeTone, normalizeTone } from './copy.js'
import { AppCtx, useApp } from './appContext.js'
import Icon from './components/Icons.jsx'
import YouSheet from './components/YouSheet.jsx'
import Login from './components/Login.jsx'
import Onboard from './components/Onboard.jsx'
import Today from './components/Today.jsx'
import Standings from './components/Standings.jsx'
import History from './components/History.jsx'
import Goals from './components/Goals.jsx'
import JudgeQueue from './components/JudgeQueue.jsx'

export default function App() {
  const [booting, setBooting] = useState(true)
  const [userId, setUserId] = useState(null)
  const [bundle, setBundle] = useState(null) // { profile, challenges, active }
  const [view, setView] = useState('today')
  // Bumped on resume/online/every minute so "today" and day math stay live —
  // critical for a home-screen app that iOS resumes from memory across days.
  const [nowTick, setNowTick] = useState(0)
  // Colorway + voice: device-cached for instant boot; profile values win post-load.
  const [theme, setThemeState] = useState(getStoredTheme)
  const [tone, setToneState] = useState(getStoredTone)
  const [youOpen, setYouOpen] = useState(false)

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { storeTone(tone) }, [tone])
  useEffect(() => {
    const t = bundle?.profile?.theme
    if (t && normalizeTheme(t) === t && t !== theme) setThemeState(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.profile?.theme])
  useEffect(() => {
    const k = bundle?.profile?.tone
    if (k && normalizeTone(k) === k && k !== tone) setToneState(k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.profile?.tone])

  const pickTheme = useCallback((k) => {
    setThemeState(k)
    if (userId) api.saveTheme(userId, k).catch(() => {})
  }, [userId])
  const pickTone = useCallback((k) => {
    setToneState(k)
    if (userId) api.saveTone(userId, k).catch(() => {})
  }, [userId])
  const t = useMemo(() => copyFor(tone), [tone])

  // Photo privacy (how challenge-mates see MY proof). Seeded from the profile,
  // updated optimistically, server-wins on refresh. No device cache needed —
  // it governs others' view, not this device's boot paint.
  const [photoSharing, setPhotoSharing] = useState('icons')
  useEffect(() => {
    const v = bundle?.profile?.photoSharing
    if (v) setPhotoSharing(v)
  }, [bundle?.profile?.photoSharing])
  const pickPhotoSharing = useCallback((v) => {
    setPhotoSharing(v)
    if (userId) api.savePhotoSharing(userId, v).catch(() => {})
  }, [userId])

  const refresh = useCallback(async (uid) => {
    const id = uid || userId
    if (!id) return null
    const data = await api.loadAll(id)
    setBundle(data)
    return data
  }, [userId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const session = await api.getSession()
        if (!alive) return
        if (session) {
          setUserId(session.user.id)
          await refresh(session.user.id)
        }
      } catch { /* show login */ } finally {
        if (alive) setBooting(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeId = bundle?.active?.challenge?.id
  useEffect(() => {
    if (!activeId) return
    return api.subscribe(activeId, () => { refresh().catch(() => {}) })
  }, [activeId, refresh])

  // Resume/reconnect handling: iOS standalone apps sleep for hours/days —
  // on wake, re-derive "today" and pull fresh data (realtime socket dies in
  // the background). Also ticks each minute so midnight rolls the day over.
  useEffect(() => {
    const bump = () => {
      setNowTick((t) => t + 1)
      refresh().catch(() => {})
    }
    const onVis = () => { if (document.visibilityState === 'visible') bump() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', bump)
    const iv = setInterval(() => setNowTick((t) => t + 1), 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', bump)
      clearInterval(iv)
    }
  }, [refresh])

  const onAuthed = useCallback(async (uid) => {
    setUserId(uid)
    await refresh(uid)
    setView('today')
  }, [refresh])

  const signOut = useCallback(async () => {
    await api.signOut()
    setUserId(null)
    setBundle(null)
  }, [])

  const switchChallenge = useCallback(async (cid) => {
    api.setActiveChallengeId(cid)
    await refresh()
    setView('today')
  }, [refresh])

  // ── derived ──
  const active = bundle?.active
  const cfg = useMemo(() => {
    if (!active) return null
    const c = active.challenge
    const parts = active.members.filter((m) => m.role === 'participant').length
    return {
      startStr: c.startDate,
      todayStr: todayInTz(c.timezone),
      totalDays: c.totalDays,
      timezone: c.timezone,
      hasReferee: active.members.some((m) => m.role === 'referee'),
      format: c.format || deriveFormat(parts),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, nowTick]) // nowTick keeps todayStr honest across midnight/resume

  // Member accents remap per colorway (identity on Midnight) — one mapping
  // point re-themes every inline style + SVG downstream.
  const themedMembers = useMemo(
    () => (active?.members || []).map((m) => ({ ...m, accent: mapAccent(theme, m.accent) })),
    [active, theme]
  )
  const participants = useMemo(() => themedMembers.filter((m) => m.role === 'participant'), [themedMembers])
  const reqsFor = useCallback((uid) => (active?.requirements || []).filter((r) => r.userId === uid), [active])
  const logsFor = useCallback((uid) => (active?.logs || []).filter((l) => l.userId === uid), [active])

  const summaries = useMemo(() => {
    if (!cfg) return {}
    const out = {}
    for (const m of participants) out[m.userId] = summarize(m, reqsFor(m.userId), logsFor(m.userId), cfg)
    return out
  }, [cfg, participants, reqsFor, logsFor])

  const actions = useMemo(() => ({
    refresh, signOut, switchChallenge,
    uploadProof: api.uploadProof, clearPhotos: api.clearPhotos, setChecked: api.setChecked,
    saveCaption: api.saveCaption, estimateMeal: api.estimateMeal, addWeighIn: api.addWeighIn,
    dismissAiFlag: api.dismissAiFlag, reviewDay: api.reviewDay,
    updateMyMember: api.updateMyMember, renameChallenge: api.renameChallenge, signedUrl: api.signedUrl,
    setReqPrivacy: api.setReqPrivacy,
  }), [refresh, signOut, switchChallenge])

  if (booting) {
    return (
      <div className="app-bg">
        <style>{THEME}</style>
        <div className="splash"><span className="splash-mark">YOU</span></div>
      </div>
    )
  }

  if (!userId) {
    return (
      <>
        <style>{THEME}</style>
        <div className="app-bg" />
        <Login onAuthed={onAuthed} />
      </>
    )
  }

  // Signed in but data didn't load (flaky network on cold launch) — don't
  // bounce to the login screen; offer a retry. Resume/online handlers also
  // auto-retry in the background.
  if (!bundle?.profile) {
    return (
      <>
        <style>{THEME}</style>
        <div className="app-bg" />
        <div className="splash" style={{ flexDirection: 'column', gap: 18 }}>
          <span className="splash-mark" style={{ animation: 'none', opacity: 1 }}>YOU</span>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {bundle ? 'Your account needs to finish setup.' : "Can't reach the server right now."}
          </p>
          <div className="row-split" style={{ width: 260 }}>
            <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
            {!bundle && <button className="btn btn-accent" onClick={() => refresh().catch(() => {})}>Retry</button>}
          </div>
        </div>
      </>
    )
  }

  if (!active) {
    return (
      <>
        <style>{THEME}</style>
        <div className="app-bg" />
        <Onboard profile={bundle.profile} onDone={() => refresh()} signOut={signOut} />
      </>
    )
  }

  const me = bundle.profile
  const myMember = themedMembers.find((m) => m.userId === me.id)
  const isReferee = myMember?.role === 'referee'
  const dayNum = currentDayNumber(cfg.startStr, cfg.todayStr)
  // Participants always get the Goals tab (it hosts goal creation);
  // referees only see it when someone actually has a goal.
  const anyGoals = !isReferee || participants.some((m) => m.goalLabel) || (active.plans || []).length > 0
  const meForfeit = !isReferee && summaries[me.id]?.forfeitTriggered
  // Per-member day counts (personal extensions). Referees track the longest run.
  const daysFor = (uid) => themedMembers.find((m) => m.userId === uid)?.totalDays || cfg.totalDays
  const maxDays = Math.max(cfg.totalDays, ...participants.map((p) => p.totalDays || 0))
  const myDays = isReferee ? maxDays : daysFor(me.id)

  const tabs = [
    ...(!isReferee ? [['today', 'today', 'Today']] : []),
    ['standings', 'versus', 'Standings'],
    ...(isReferee ? [['judge', 'gavel', 'Judge']] : []),
    ['history', 'grid', 'History'],
    ...(anyGoals ? [['goals', 'target', 'Goals']] : []),
  ]
  const activeView = tabs.some(([k]) => k === view) ? view : tabs[0][0]

  const plans = active.plans || []
  const weighIns = active.weighIns || []
  const myPlans = plans.filter((p) => p.userId === me.id)
  // Newest plan drives the daily macro bar (one diet at a time, many goals).
  const myPlan = myPlans[myPlans.length - 1] || null

  const ctx = {
    cfg, challenge: active.challenge, members: themedMembers, participants,
    requirements: active.requirements, logs: active.logs,
    plans, weighIns, myPlan, myPlans,
    me, myMember, isReferee, summaries, reqsFor, logsFor, daysFor, maxDays, actions,
    t, tone,
    view: activeView, setView,
  }

  return (
    <AppCtx.Provider value={ctx}>
      <style>{THEME}</style>
      <div className="app-bg" />
      <div className="shell">
        <header className="topbar">
          <div className="brand" title={active.challenge.name}>
            <span className="brand-name">{active.challenge.name}</span>
          </div>
          <div className="daypill">
            {dayNum < 1 ? <>STARTS SOON</> : dayNum > myDays ? <>COMPLETE</> : (
              <><span className="daypill-k">DAY</span><span className="daypill-n">{dayNum}</span><span className="daypill-t">/ {myDays}</span></>
            )}
          </div>
          <div className="top-right">
            {bundle.challenges.length > 1 && (
              <select className="chal-switch" value={active.challenge.id} onChange={(e) => switchChallenge(e.target.value)}>
                {bundle.challenges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button className="avatar-btn" onClick={() => setYouOpen(true)} title="You" aria-label="Your settings">
              {meForfeit && myMember?.stakeImage ? (
                <span className="avatar forfeit"><img src={myMember.stakeImage} alt="" /></span>
              ) : isReferee && myMember?.stakeImage ? (
                <span className="avatar referee"><img src={myMember.stakeImage} alt="" /></span>
              ) : (
                <span className="avatar" style={{ '--ac': myMember?.accent || mapAccent(theme, '#FF3B30') }}>{me.displayName[0]}</span>
              )}
            </button>
            <button className="iconbtn" onClick={signOut} title="Sign out"><Icon name="logout" size={18} /></button>
          </div>
        </header>
        {youOpen && (
          <YouSheet theme={theme} onPickTheme={pickTheme} tone={tone} onPickTone={pickTone}
            sharing={photoSharing} onPickSharing={pickPhotoSharing}
            photoReqs={reqsFor(me.id).filter((r) => r.kind === 'photo' && !api.isExtraMeal(r))}
            onToggleReq={async (reqId, next) => { await api.setReqPrivacy(reqId, next); await refresh() }}
            showPrivacy={!isReferee}
            onClose={() => setYouOpen(false)} />
        )}

        <main className="view">
          {activeView === 'today' && <Today />}
          {activeView === 'standings' && <Standings />}
          {activeView === 'history' && <History />}
          {activeView === 'goals' && <Goals />}
          {activeView === 'judge' && <JudgeQueue />}
        </main>

        <nav className="tabbar">
          {tabs.map(([key, icon, label]) => (
            <button key={key} className={'tab' + (activeView === key ? ' active' : '')} onClick={() => setView(key)}>
              <Icon name={icon} size={22} />
              <span>{label}</span>
              {key === 'judge' && <JudgeBadge />}
            </button>
          ))}
        </nav>
      </div>
    </AppCtx.Provider>
  )
}

function JudgeBadge() {
  const { logs, participants, reqsFor } = useApp()
  let n = 0
  for (const l of logs) {
    if (l.status !== 'pending') continue
    const reqs = reqsFor(l.userId)
    if (reqs.length && reqs.every((r) => {
      const e = l.entriesByReq[r.id]
      return r.kind === 'photo' ? !!e?.photoPath : !!e?.checked
    })) n++
  }
  if (!n || !participants.length) return null
  return <span className="tab-badge">{n}</span>
}

// ════════════════════════════════════════════════════════════════════════
const THEME = `
:root{
  --bg:#08080b; --panel:#14141b; --panel-2:#1b1b24; --panel-3:#22222d;
  --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.16);
  --text:#f5f5f7; --muted:#8d8d99; --muted-2:#5f5f6b;
  --red:#FF3B30; --green:#30D158; --gold:#FFD60A; --amber:#FF9F0A; --blue:#0A84FF; --purple:#BF5AF2;
  /* identity + text-on-color */
  --brand:#FF3B30;
  --on-accent:#0b0b0f; --on-green:#06210f; --on-amber:#2a1c00; --on-red:#fff;
  /* photo overlays — fixed dark in EVERY theme (photos always get dark scrims) */
  --scrim:#08080b; --on-scrim:#f5f5f7; --on-scrim-muted:#8d8d99;
  --glass-hi:rgba(255,255,255,.09); --glass-hi-2:rgba(255,255,255,.02); --glass-line:rgba(255,255,255,.11);
  /* ambient */
  --glow-1:#18121a; --glow-2:#101620; --glow-fade:rgba(8,8,11,0);
  --ring:rgba(255,255,255,.1);
  --gc-face1:#16251b; --gc-face2:#0b140e; --gc-star:rgba(200,255,215,.95);
  --display:'Anton',sans-serif; --cond:'Oswald',sans-serif; --sans:'Inter',sans-serif;
  --r:18px; --r-sm:12px;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body,#root{margin:0;min-height:100%;background:var(--bg)}
body{font-family:var(--sans);color:var(--text);-webkit-font-smoothing:antialiased;overscroll-behavior-y:none}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
/* app-like touch feel: no long-press callouts / text selection on controls */
button,.tab,.slot,.cal-cell,.watertoggle{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
/* touch devices: neutralize sticky :hover states */
@media (hover: none){
  .slot:not(.locked):hover,.today-card:hover,.onb-choice .card:hover{border-color:var(--line)}
  .iconbtn:hover{color:var(--muted);border-color:var(--line)}
}
input,select,textarea{font-family:inherit}
img{display:block;max-width:100%}

.app-bg{position:fixed;inset:0;z-index:-1;background:
  radial-gradient(120% 70% at 50% -10%, var(--glow-1) 0%, var(--glow-fade) 55%),
  radial-gradient(90% 60% at 100% 0%, var(--glow-2) 0%, var(--glow-fade) 50%),
  var(--bg);}

.splash{height:100vh;display:flex;align-items:center;justify-content:center}
.splash-mark{font-family:var(--display);font-size:64px;color:var(--brand);letter-spacing:2px;
  animation:pulse 1.1s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.97)}50%{opacity:1;transform:scale(1.02)}}

.shell{max-width:600px;margin:0 auto;min-height:100vh;
  padding-bottom:calc(110px + env(safe-area-inset-bottom));position:relative}

/* topbar */
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;
  gap:10px;padding:14px 18px;padding-top:calc(14px + env(safe-area-inset-top));backdrop-filter:blur(16px);
  background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 92%,transparent),color-mix(in srgb,var(--bg) 55%,transparent));
  border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;min-width:0;max-width:46%}
.brand::before{content:'';width:4px;height:20px;border-radius:2px;background:var(--brand);flex:none}
.brand-name{font-family:var(--cond);font-weight:700;font-size:17px;letter-spacing:1px;text-transform:uppercase;
  color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1}
.brand-mark{font-family:var(--display);font-size:26px;color:var(--brand);line-height:1;letter-spacing:1px}
.brand-word{font-family:var(--cond);font-weight:700;font-size:18px;letter-spacing:3px;color:var(--text)}
.rename-chip{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font:inherit}
.rename-chip svg{opacity:.6}
.rename-chip:active{color:var(--text)}
.daypill{display:flex;align-items:baseline;gap:6px;padding:7px 14px;border:1px solid var(--line-2);
  border-radius:999px;background:var(--panel);font-family:var(--cond);letter-spacing:1px}
.daypill-k{font-size:11px;color:var(--muted);font-weight:600}
.daypill-n{font-family:var(--display);font-size:20px;line-height:1}
.daypill-t{font-size:12px;color:var(--muted)}
.top-right{display:flex;align-items:center;gap:8px}
.chal-switch{background:var(--panel);border:1px solid var(--line-2);color:var(--text);border-radius:10px;
  padding:6px 8px;font-size:12px;max-width:110px}
.avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-family:var(--cond);
  font-weight:700;font-size:15px;color:var(--on-accent);background:var(--ac);box-shadow:0 0 0 2px var(--ring)}
.avatar.forfeit{padding:0;overflow:hidden;background:#0c0c10;box-shadow:0 0 0 2px var(--red),0 0 12px color-mix(in srgb,var(--red) 55%,transparent)}
.avatar.forfeit img{width:100%;height:100%;object-fit:cover;object-position:50% 14%}
.avatar.referee{padding:0;overflow:hidden;background:#0c0c10;box-shadow:0 0 0 2px var(--gold),0 0 12px color-mix(in srgb,var(--gold) 50%,transparent)}
.avatar.referee img{width:100%;height:100%;object-fit:cover;object-position:50% 16%}
.iconbtn{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--muted);
  border:1px solid var(--line)}
.iconbtn:hover{color:var(--text);border-color:var(--line-2)}

/* views */
.view{padding:18px 16px 8px}
.screen-head{display:flex;align-items:flex-end;justify-content:space-between;margin:2px 2px 16px}
.screen-title{font-family:var(--cond);font-weight:700;font-size:26px;letter-spacing:1px;text-transform:uppercase}
.screen-sub{color:var(--muted);font-size:13px;margin-top:2px}
.section-label{font-family:var(--cond);font-weight:600;font-size:12px;letter-spacing:2.5px;
  text-transform:uppercase;color:var(--muted);margin:22px 4px 10px}
.new-badge{margin-left:10px;font-size:10px;letter-spacing:1px;color:var(--green);
  border:1px solid color-mix(in srgb,var(--green) 35%,transparent);background:color-mix(in srgb,var(--green) 8%,transparent);border-radius:99px;padding:2px 8px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:18px}
.card+.card{margin-top:12px}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 18px;border-radius:14px;
  font-family:var(--cond);font-weight:600;font-size:15px;letter-spacing:1px;text-transform:uppercase;
  background:var(--panel-3);border:1px solid var(--line-2);transition:transform .06s,filter .15s}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-block{width:100%}
.btn-accent{background:var(--brand);border-color:var(--brand);color:var(--on-red)}
.btn-accent:hover{filter:brightness(1.08)}
.btn-go{background:var(--green);border-color:var(--green);color:var(--on-green)}
.btn-danger{background:transparent;border-color:color-mix(in srgb,var(--red) 50%,transparent);color:var(--red)}
.btn-ghost{background:transparent}
.btn-sm{padding:8px 12px;font-size:12px;border-radius:10px}

/* chips */
.chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-family:var(--cond);
  font-weight:600;font-size:11px;letter-spacing:1px;text-transform:uppercase;border:1px solid var(--line-2)}
.chip svg{width:13px;height:13px}
.chip-green{color:var(--green);border-color:color-mix(in srgb,var(--green) 40%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.chip-amber{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,transparent);background:color-mix(in srgb,var(--amber) 10%,transparent)}
.chip-red{color:var(--red);border-color:color-mix(in srgb,var(--red) 40%,transparent);background:color-mix(in srgb,var(--red) 10%,transparent)}
.chip-gold{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 40%,transparent);background:color-mix(in srgb,var(--gold) 10%,transparent)}
.chip-muted{color:var(--muted);background:var(--panel-2)}

.bar{height:8px;border-radius:999px;background:var(--panel-3);overflow:hidden}
.bar-fill{height:100%;border-radius:999px;transition:width .5s cubic-bezier(.2,.8,.2,1)}

/* ── standings ── */
.scoreboard{display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:stretch;
  background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:16px 8px;margin-bottom:14px}
.scoreboard.solo{grid-template-columns:1fr}
.scoreboard.grid{grid-template-columns:1fr 1fr}
.vs-col{text-align:center;padding:4px 8px}
.vs-name{font-family:var(--cond);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:15px;
  display:inline-flex;align-items:center;gap:7px}
.vs-dot{width:9px;height:9px;border-radius:50%}
.vs-day{font-family:var(--display);font-size:60px;line-height:.95;margin:6px 0 0}
.vs-day small{font-family:var(--cond);font-size:16px;color:var(--muted);font-weight:500}
.vs-row{display:flex;justify-content:center;gap:14px;margin-top:10px}
.vs-mini{text-align:center}
.vs-mini-n{font-family:var(--cond);font-weight:700;font-size:20px}
.vs-mini-l{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted-2)}
.vs-divider{display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:22px;
  color:var(--muted-2)}
.leaderboard{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:6px 4px}
.lb-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px}
.lb-row.me{background:var(--panel-2)}
.lb-rank{font-family:var(--display);font-size:15px;color:var(--muted-2);width:18px;text-align:center}
.lb-name{flex:1;font-family:var(--cond);font-weight:600;font-size:15px;letter-spacing:.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-streak{display:inline-flex;align-items:center;gap:3px;color:var(--amber);font-family:var(--cond);
  font-weight:600;font-size:13px}
.lb-days{font-family:var(--display);font-size:18px;line-height:1}
.lb-days small{font-family:var(--cond);font-size:11px;color:var(--muted);font-weight:500}
.lb-bar{flex-basis:56px;flex-shrink:0;height:5px;border-radius:3px;background:var(--panel-3);overflow:hidden}
.lb-fill{display:block;height:100%;border-radius:3px}
.vs-streak{display:inline-flex;align-items:center;gap:4px;color:var(--amber);font-family:var(--cond);
  font-weight:600;font-size:13px;margin-top:8px}

/* today cards */
.today-card{display:block;width:100%;text-align:left;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r);padding:14px;margin-bottom:10px;transition:border-color .15s,transform .06s}
.today-card:hover{border-color:var(--line-2)}
.tc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}
.tc-you{font-family:var(--cond);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted-2);
  border:1px solid var(--line-2);border-radius:99px;padding:1px 6px;margin-left:8px}
.tc-count{font-family:var(--display);font-size:24px;line-height:1}
.tc-count small{font-family:var(--cond);font-size:13px;color:var(--muted);font-weight:500}
.tc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.tc-cell{position:relative;aspect-ratio:1/1;border-radius:8px;overflow:hidden;border:1px solid var(--line);
  background:var(--panel-2);display:grid;place-items:center;color:var(--muted-2)}
.tc-cell img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tc-cell.done{border-color:transparent}
.tc-check{position:absolute;bottom:3px;right:3px;width:15px;height:15px;border-radius:50%;background:var(--green);
  color:var(--on-green);display:grid;place-items:center;box-shadow:0 0 0 2px color-mix(in srgb,var(--scrim) 50%,transparent)}
.tc-foot{display:flex;align-items:center;margin-top:12px}
.prow-nums{display:flex;align-items:baseline;gap:14px}
.prow-icons{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.prow-ic{position:relative;width:28px;height:28px;border-radius:8px;background:var(--panel-2);
  border:1px solid var(--line);display:grid;place-items:center;color:var(--muted-2)}
.prow-ic.done{color:var(--text);border-color:color-mix(in srgb, var(--green) 40%, transparent)}
.prow-ic .tc-check{bottom:-4px;right:-4px}
.prow-more{font-family:var(--cond);font-size:11px;font-weight:600;color:var(--muted)}
.tc-tap{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-family:var(--cond);font-size:11px;
  letter-spacing:1px;text-transform:uppercase;color:var(--muted)}

/* stakes */
.stakes{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px}
.stakes.solo{grid-template-columns:1fr}
.stake{position:relative;border-radius:var(--r);padding:14px;border:1px solid var(--line);
  background:var(--panel);overflow:hidden}
.stake .stake-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.stake-name{font-family:var(--cond);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:14px}
.stake-forfeit{font-size:13px;color:var(--muted);line-height:1.35}
.stake-status{font-family:var(--cond);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-top:10px;
  display:flex;align-items:center;gap:6px;color:var(--green)}
.stake.lit{border-color:color-mix(in srgb,var(--red) 55%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--red) 14%,transparent),color-mix(in srgb,var(--red) 3%,transparent))}
.stake.lit .stake-status{color:var(--red)}
.stake-portrait{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;border-radius:14px;
  margin-bottom:12px;background:radial-gradient(ellipse at 50% 32%, #1a1a22, #08080b)}
.forfeit-head{width:100%;height:100%;object-fit:cover;object-position:50% 16%;display:block;opacity:.92;
  transition:filter .5s,opacity .5s,transform .5s}
.stake.lit .stake-portrait .forfeit-head{filter:brightness(1.04);opacity:1;animation:dread 2.4s ease-in-out infinite}
.stake.lit .stake-portrait{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--red) 50%,transparent),0 0 30px color-mix(in srgb,var(--red) 22%,transparent)}
@keyframes dread{0%,100%{transform:scale(1.01) rotate(0)}25%{transform:scale(1.03) rotate(-.7deg)}75%{transform:scale(1.03) rotate(.7deg)}}
.stake-stamp{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-12deg);
  font-family:var(--cond);font-weight:700;letter-spacing:3px;font-size:19px;text-transform:uppercase;
  color:var(--red);border:2px solid var(--red);padding:3px 11px;border-radius:6px;background:color-mix(in srgb,var(--scrim) 35%,transparent);
  opacity:0;transition:opacity .4s;pointer-events:none}
.stake.lit .stake-stamp{animation:stampin .45s ease forwards}
@keyframes stampin{from{transform:translate(-50%,-50%) rotate(-12deg) scale(1.7);opacity:0}to{transform:translate(-50%,-50%) rotate(-12deg) scale(1);opacity:.95}}
.stake-safe-tag{position:absolute;bottom:8px;left:8px;font-family:var(--cond);font-size:10px;letter-spacing:1.5px;
  text-transform:uppercase;color:var(--on-scrim-muted);background:color-mix(in srgb,var(--scrim) 55%,transparent);padding:3px 8px;border-radius:6px}
.stake.lit .stake-safe-tag{display:none}

/* referee strip */
.ref-strip{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r);padding:11px 14px;margin-bottom:14px}
.ref-strip .rs-head{width:46px;height:46px;border-radius:50%;overflow:hidden;flex:none;border:1px solid var(--gold);
  background:radial-gradient(ellipse at 50% 30%,#16161d,#08080b);display:grid;place-items:center;color:var(--gold)}
.ref-strip .rs-head img{width:100%;height:100%;object-fit:cover;object-position:50% 14%}
.ref-strip .rs-name{font-family:var(--cond);font-weight:700;letter-spacing:.5px;color:var(--gold);font-size:14px}
.ref-strip .rs-sub{font-size:12px;color:var(--muted)}

/* photo slots (today) */
.today-hero{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.today-hero .h-day{font-family:var(--display);font-size:40px;line-height:1}
.slots-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.slot{position:relative;border-radius:var(--r-sm);border:1px solid var(--line);background:var(--panel);
  overflow:hidden;aspect-ratio:1/1;display:flex;flex-direction:column;justify-content:flex-end;
  padding:12px;transition:border-color .15s}
.slot:not(.locked):hover{border-color:var(--line-2)}
.slot .slot-ic{position:absolute;top:12px;left:12px;color:var(--muted)}
.slot .slot-label{font-family:var(--cond);font-weight:600;font-size:14px;letter-spacing:.5px;z-index:2}
.slot .slot-hint{font-size:11px;color:var(--muted);z-index:2;margin-top:1px}
.slot .slot-thumb{position:absolute;inset:0}
.slot .slot-thumb img{object-fit:cover;width:100%;height:100%}
.slot.filled::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--scrim) 10%,transparent),color-mix(in srgb,var(--scrim) 85%,transparent));z-index:1}
.slot.filled .slot-ic{display:none}
/* text over photo scrims stays light in every theme (incl. Sand) */
.slot.filled .slot-label{color:var(--on-scrim)}
.slot.filled .slot-hint{color:var(--on-scrim-muted)}
.slot-check{position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:50%;display:grid;
  place-items:center;background:var(--green);color:var(--on-green);z-index:3}
.slot.uploading{opacity:.6}
.slot.locked{opacity:.85}
.slot input{position:absolute;inset:0;opacity:0;cursor:pointer;z-index:4}
.slot.locked input{display:none}
.slot.add-meal{border:1px dashed var(--line-2);background:color-mix(in srgb,var(--green) 4%,transparent);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center}
.slot.add-meal:active{border-color:var(--green)}
.slot.add-meal .slot-ic{position:static;color:var(--green);opacity:.85;margin-bottom:2px}
.slot.add-meal .slot-label{position:static;color:var(--text);font-size:13px}
.slot.add-meal .slot-hint{position:static;padding:0 12px}
.slot-stack{position:absolute;top:10px;left:10px;z-index:3;font-family:var(--cond);font-weight:600;font-size:10px;
  letter-spacing:1px;text-transform:uppercase;background:color-mix(in srgb,var(--scrim) 70%,transparent);color:var(--on-scrim);
  padding:3px 8px;border-radius:99px;border:1px solid var(--glass-line)}
.slot-min{position:absolute;bottom:10px;right:10px;z-index:3;font-family:var(--cond);font-weight:600;font-size:10px;
  letter-spacing:1px;background:color-mix(in srgb,var(--amber) 18%,transparent);color:var(--amber);border:1px solid color-mix(in srgb,var(--amber) 40%,transparent);
  padding:2px 7px;border-radius:99px}
.slot-clear{position:absolute;top:42px;right:10px;z-index:5;width:24px;height:24px;border-radius:50%;
  background:color-mix(in srgb,var(--scrim) 75%,transparent);color:var(--on-scrim-muted);display:grid;place-items:center;border:1px solid var(--glass-line)}

/* ── body goal: macro bar, fuel log, trend ── */
.macrobar{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin-top:12px}
.mb-row{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.mb-label{font-family:var(--cond);font-weight:600;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;
  color:var(--muted);width:64px;flex:none}
.mb-num{font-size:12px;color:var(--muted);flex:none;min-width:96px;text-align:right}
.mb-num b{color:var(--text);font-size:14px}
.mb-hint{font-size:11px;color:var(--muted-2);margin-top:2px}
.fr-input{background:var(--panel-2);border:1px solid var(--line-2);border-radius:12px;padding:12px 13px;
  color:var(--text);font-size:15px;min-width:0}
.fr-input:focus{outline:none;border-color:var(--green)}
/* caption + macros live on the meal tile; z-5 sits above the file input */
/* liquid-glass caption pill: frosted, translucent, soft top highlight */
.slot-cap{position:relative;z-index:5;display:block;width:100%;text-align:left;padding:7px 10px;margin-top:6px;
  border-radius:13px;
  background:linear-gradient(180deg,var(--glass-hi),var(--glass-hi-2));
  backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);
  border:1px solid var(--glass-line);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 3px 12px rgba(0,0,0,.28);
  transition:background .15s}
.slot-cap:active{background:linear-gradient(180deg,rgba(255,255,255,.15),rgba(255,255,255,.05))}
.slot-cap .sc-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  font-size:11px;color:var(--on-scrim);opacity:.96;line-height:1.35}
.slot-cap .sc-edit{color:var(--on-scrim-muted);opacity:.7;margin-left:4px;vertical-align:-1px}
.slot-cap.empty{display:inline-block;width:auto}
.slot-cap.empty .sc-text{color:#cfead6;font-family:var(--cond);font-weight:600;letter-spacing:.5px;text-transform:uppercase;font-size:10px}
.slot-cap .sc-est{display:block;font-size:10px;color:#30D158;margin-top:2px}
.trend{width:100%;height:72px;margin-top:12px;display:block}

/* ── goal coach chat ── */
.goal-create{position:relative;overflow:hidden;display:flex;align-items:center;gap:14px;width:100%;
  text-align:left;border-radius:var(--r);padding:17px 18px;margin-top:6px;color:var(--muted);
  background:linear-gradient(180deg,var(--gc-face1) 0%,var(--gc-face2) 100%);
  border:1px solid color-mix(in srgb,var(--green) 30%,transparent);
  box-shadow:0 12px 28px -10px color-mix(in srgb,var(--green) 28%,transparent),0 4px 10px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.1),inset 0 -2px 0 rgba(0,0,0,.4);
  transition:transform .12s ease,box-shadow .12s ease}
.goal-create:active{transform:translateY(2px);
  box-shadow:0 5px 14px -8px color-mix(in srgb,var(--green) 25%,transparent),0 1px 3px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.06),inset 0 -1px 0 rgba(0,0,0,.3)}
/* slow sheen sweep across the face */
.goal-create::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.08) 50%,transparent 58%);
  transform:translateX(-130%);animation:gc-sheen 7s ease-in-out infinite}
@keyframes gc-sheen{0%,74%{transform:translateX(-130%)}90%,100%{transform:translateX(130%)}}
/* tiny four-point stars, staggered twinkle */
.gc-stars{position:absolute;inset:0;pointer-events:none}
.gc-stars i{position:absolute;width:6px;height:6px;background:var(--gc-star);
  clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);
  opacity:0;animation:gc-twinkle 4.4s ease-in-out infinite}
.gc-stars i:nth-child(1){top:16%;left:7%;animation-delay:.5s}
.gc-stars i:nth-child(2){top:64%;left:26%;width:4px;height:4px;animation-delay:1.8s}
.gc-stars i:nth-child(3){top:20%;right:13%;width:5px;height:5px;animation-delay:3s}
.gc-stars i:nth-child(4){bottom:18%;right:32%;width:4px;height:4px;animation-delay:3.9s}
@keyframes gc-twinkle{0%,100%{opacity:0;transform:scale(.4) rotate(0deg)}50%{opacity:.8;transform:scale(1) rotate(24deg)}}
@media (prefers-reduced-motion: reduce){.goal-create::after,.gc-stars i{animation:none}}
.goal-create .gc-ic{width:42px;height:42px;border-radius:12px;background:color-mix(in srgb,var(--green) 14%,transparent);
  border:1px solid color-mix(in srgb,var(--green) 40%,transparent);display:grid;place-items:center;color:var(--green);flex:none;
  box-shadow:0 0 18px color-mix(in srgb,var(--green) 30%,transparent),inset 0 1px 0 rgba(255,255,255,.15)}
.goal-create .gc-txt{flex:1;min-width:0}
.goal-create .gc-txt b{display:block;color:var(--text);font-family:var(--cond);font-weight:600;
  letter-spacing:1px;text-transform:uppercase;font-size:14px}
.goal-create .gc-txt small{font-size:12px;color:var(--muted);line-height:1.35;display:block;margin-top:2px}
.coach{position:fixed;top:0;left:0;right:0;z-index:70;height:100dvh;background:var(--bg);
  display:flex;flex-direction:column;will-change:height,transform}
.coach-head{display:flex;align-items:center;justify-content:space-between;flex:none;
  padding:calc(12px + env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid var(--line)}
.coach-title{display:inline-flex;align-items:center;gap:8px;font-family:var(--cond);font-weight:600;
  font-size:14px;letter-spacing:2px;text-transform:uppercase;color:var(--text)}
.coach-title svg{color:var(--green)}
.coach-msgs{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:16px;display:flex;
  flex-direction:column;gap:10px}
.cm{max-width:85%;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap}
.cm.ai{align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:6px}
.cm.user{align-self:flex-end;background:color-mix(in srgb,var(--blue) 16%,transparent);border:1px solid color-mix(in srgb,var(--blue) 30%,transparent);
  border-bottom-right-radius:6px}
.cm.thinking{color:var(--muted);font-style:italic;animation:pulse 1.2s ease-in-out infinite}
.coach-input{flex:none;display:flex;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top:1px solid var(--line);background:var(--bg)}
.coach-input input{flex:1;background:var(--panel);border:1px solid var(--line-2);border-radius:99px;
  padding:12px 18px;color:var(--text);font-size:15px;min-width:0;outline:none}
.coach-input input:focus{border-color:var(--green)}
.coach-send{width:46px;height:46px;border-radius:50%;background:var(--green);color:var(--on-green);
  display:grid;place-items:center;flex:none}
.coach-send:disabled{opacity:.35}
.plan-preview{align-self:stretch;background:var(--panel);border:1px solid color-mix(in srgb,var(--green) 35%,transparent);
  border-radius:var(--r);padding:16px;margin-top:4px}
.pp-title{display:inline-flex;align-items:center;gap:6px;font-family:var(--cond);font-weight:600;
  font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--green);margin-bottom:6px}
.pp-goal{font-family:var(--cond);font-weight:600;font-size:19px;margin-bottom:10px}
.pp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:12px;color:var(--muted)}
.pp-grid b{color:var(--text)}

/* checklist editor extras (photo items) */
.br-extras{display:flex;gap:10px;align-items:center;margin:-4px 0 10px 4px}
.mini-toggle{display:inline-flex;align-items:center;gap:5px;font-family:var(--cond);font-weight:600;font-size:11px;
  letter-spacing:.5px;text-transform:uppercase;color:var(--muted);border:1px solid var(--line-2);
  border-radius:99px;padding:4px 10px}
.mini-toggle.on{color:var(--green);border-color:color-mix(in srgb,var(--green) 45%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.mini-min{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
.mini-min input{width:52px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;
  padding:4px 6px;color:var(--text);font-size:13px;text-align:center}

/* AI flag */
.ai-chip{position:absolute;top:10px;left:10px;right:44px;z-index:3;display:flex;align-items:center;gap:5px;
  background:color-mix(in srgb,var(--amber) 92%,transparent);color:var(--on-amber);border-radius:8px;padding:4px 8px;font-size:10px;font-weight:600}
.ai-note{margin-top:8px;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb,var(--amber) 40%,transparent);
  background:color-mix(in srgb,var(--amber) 8%,transparent);font-size:12px;color:var(--text);display:flex;gap:10px;align-items:flex-start}
.ai-note .an-txt{flex:1;line-height:1.45}
.ai-note .an-txt b{color:var(--amber)}

.watertoggle{display:flex;align-items:center;gap:14px;margin-top:10px;padding:16px 18px;border-radius:var(--r);
  border:1px solid var(--line);background:var(--panel);cursor:pointer;width:100%;text-align:left}
.watertoggle .wt-box{width:30px;height:30px;border-radius:9px;border:2px solid var(--line-2);display:grid;
  place-items:center;flex:none;transition:.15s}
.watertoggle .wt-title{font-family:var(--cond);font-weight:600;font-size:15px}
.watertoggle .wt-hint{font-size:12px;color:var(--muted)}

.daybanner{margin-top:14px;padding:16px;border-radius:var(--r);text-align:center;border:1px solid var(--line)}
.daybanner.done{background:linear-gradient(180deg,color-mix(in srgb,var(--green) 16%,transparent),color-mix(in srgb,var(--green) 3%,transparent));border-color:color-mix(in srgb,var(--green) 40%,transparent)}
.daybanner.review{background:linear-gradient(180deg,color-mix(in srgb,var(--amber) 14%,transparent),color-mix(in srgb,var(--amber) 3%,transparent));border-color:color-mix(in srgb,var(--amber) 40%,transparent)}
.daybanner.rejected{background:linear-gradient(180deg,color-mix(in srgb,var(--red) 14%,transparent),color-mix(in srgb,var(--red) 3%,transparent));border-color:color-mix(in srgb,var(--red) 40%,transparent)}
.daybanner .db-title{font-family:var(--cond);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:16px}
.daybanner .db-sub{font-size:13px;color:var(--muted);margin-top:3px}

.ring{transform:rotate(-90deg)}
.ring-bg{stroke:var(--panel-3)}
.ring-label{font-family:var(--display);font-size:18px;fill:var(--text)}

/* calendar / history */
.cal-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:5px}
.cal-cell{aspect-ratio:1/1;border-radius:6px;border:1px solid var(--line);display:grid;place-items:center;
  font-family:var(--cond);font-size:11px;color:var(--muted-2);position:relative;cursor:default}
.cal-cell.has{cursor:pointer}
.cal-cell.approved{background:color-mix(in srgb,var(--green) 85%,transparent);color:var(--on-green);border-color:transparent;font-weight:600}
.cal-cell.pending{background:color-mix(in srgb,var(--amber) 85%,transparent);color:var(--on-amber);border-color:transparent;font-weight:600}
.cal-cell.fail{background:color-mix(in srgb,var(--red) 85%,transparent);color:var(--on-red);border-color:transparent;font-weight:600}
.cal-cell.active{border-color:var(--text);color:var(--text);font-weight:600}
.cal-cell.today::after{content:'';position:absolute;bottom:3px;width:4px;height:4px;border-radius:50%;background:currentColor}
.cal-cell.add{border:1px dashed var(--line-2);color:var(--muted);cursor:pointer;background:transparent}
.cal-cell.add:active{color:var(--green);border-color:var(--green)}
.add-days-cap{display:block;margin:8px 2px 0;font-family:var(--cond);font-size:11px;letter-spacing:1.5px;
  text-transform:uppercase;color:var(--muted)}
.add-days-cap:active{color:var(--green)}
.hist-person{margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}
.hist-name{font-family:var(--cond);font-weight:700;text-transform:uppercase;letter-spacing:1px;display:flex;gap:8px;align-items:center}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin:12px 2px 0;color:var(--muted);font-size:11px}
.legend span{display:inline-flex;align-items:center;gap:5px}
.legend i{width:10px;height:10px;border-radius:3px;display:inline-block}

/* goals */
.goal-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:18px;margin-bottom:12px;
  position:relative;overflow:hidden}
.goal-card::before{content:'';position:absolute;inset:0 0 auto 0;height:110px;pointer-events:none;
  background:linear-gradient(180deg,var(--gc-wash,transparent),transparent)}
.goal-card>*{position:relative}
.ms-title{display:inline-flex;align-items:center;gap:8px;font-family:var(--cond);font-weight:600;font-size:12px;
  letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
.ms-badge{width:20px;height:20px;border-radius:6px;border:1px solid var(--line-2);display:inline-grid;place-items:center;
  font-family:var(--cond);font-size:11px;font-weight:700;color:var(--text);background:var(--panel-2)}
.bg-stats{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:16px 0 2px}
.bg-now .n{font-family:var(--display);font-size:42px;line-height:1}
.bg-now .u{font-family:var(--cond);color:var(--muted);font-size:14px;margin-left:6px}
.bg-now .cap{font-family:var(--cond);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted-2);margin-top:4px}
.bg-pace{text-align:right;max-width:55%}
.bg-hint{font-size:11px;color:var(--muted-2);line-height:1.4;margin-top:2px}
.weigh-row{display:flex;gap:10px;margin-top:14px}
.weigh-input{flex:1;display:flex;align-items:center;gap:8px;background:var(--panel-2);border:1px solid var(--line-2);
  border-radius:13px;padding:0 14px;min-width:0}
.weigh-input input{flex:1;background:none;border:none;color:var(--text);font-size:16px;font-family:var(--cond);
  padding:12px 0;outline:none;min-width:0}
.weigh-input .u{color:var(--muted);font-size:11px;font-family:var(--cond);letter-spacing:1px;text-transform:uppercase;flex:none}
.goal-top{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.goal-name{font-family:var(--cond);font-weight:700;font-size:18px;letter-spacing:.5px}
.goal-milestone{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.goal-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.counter{display:flex;align-items:center;gap:12px}
.counter button{width:40px;height:40px;border-radius:11px;border:1px solid var(--line-2);display:grid;place-items:center;background:var(--panel-3)}
.counter button:active{transform:scale(.94)}
.countdown{font-family:var(--cond);font-weight:600;font-size:13px;letter-spacing:.5px}

/* judge queue */
.jb-head{width:54px;height:54px;border-radius:50%;overflow:hidden;flex:none;border:2px solid var(--gold);
  background:radial-gradient(ellipse at 50% 30%,#16161d,#08080b);box-shadow:0 0 16px color-mix(in srgb,var(--gold) 25%,transparent)}
.jb-head img{width:100%;height:100%;object-fit:cover;object-position:50% 14%}
.review-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-bottom:14px}
.review-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.proof-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.proof-thumb{aspect-ratio:1/1;border-radius:8px;overflow:hidden;border:1px solid var(--line);position:relative;background:var(--panel-2)}
.proof-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.proof-thumb .pt-label{position:absolute;bottom:0;left:0;right:0;font-size:9px;letter-spacing:.5px;text-transform:uppercase;
  padding:3px 5px;background:color-mix(in srgb,var(--scrim) 70%,transparent);color:var(--on-scrim-muted)}
.proof-thumb.check-tile{display:grid;place-items:center}
.pt-badge{position:absolute;top:5px;right:5px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;z-index:2}
.pt-badge.ok{background:var(--green);color:var(--on-green)}
.pt-badge.no{background:var(--panel-3);color:var(--muted-2);border:1px solid var(--line-2)}
.pt-badge.ai{background:var(--amber);color:var(--on-amber)}
.review-actions{display:flex;gap:10px;margin-top:14px}
.review-actions .btn{flex:1}
.note-input{width:100%;margin-top:10px;background:var(--panel-2);border:1px solid var(--line);border-radius:12px;
  padding:11px 13px;color:var(--text);font-size:14px;resize:vertical;min-height:42px}

/* modal */
.modal-backdrop{position:fixed;inset:0;z-index:60;background:rgba(4,4,7,.78);backdrop-filter:blur(6px);
  display:flex;align-items:flex-end;justify-content:center;padding:0}
.modal{width:100%;max-width:600px;max-height:88vh;overflow:auto;background:var(--panel);
  border-top-left-radius:22px;border-top-right-radius:22px;border:1px solid var(--line);
  padding:18px 16px calc(30px + env(safe-area-inset-bottom));animation:slideup .26s cubic-bezier(.2,.8,.2,1);
  overscroll-behavior:contain;-webkit-overflow-scrolling:touch;will-change:transform}
@keyframes slideup{from{transform:translateY(40px);opacity:.6}to{transform:translateY(0);opacity:1}}
.modal-grip{width:40px;height:4px;border-radius:99px;background:var(--line-2);margin:0 auto 14px}
/* top-anchored dialog: for sheets with text inputs, out of the keyboard's reach */
.modal-backdrop.top{align-items:flex-start}
.modal-backdrop.top .modal{width:calc(100% - 24px);max-width:560px;border-radius:20px;
  margin:calc(18px + env(safe-area-inset-top)) 12px 0;max-height:70vh;
  animation:dropdown .22s cubic-bezier(.2,.8,.2,1)}
@keyframes dropdown{from{transform:translateY(-24px);opacity:.5}to{transform:translateY(0);opacity:1}}
.modal-photos{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.modal-photo{border-radius:12px;overflow:hidden;border:1px solid var(--line);position:relative;aspect-ratio:3/4;background:var(--panel-2)}
.modal-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.modal-photo .mp-label{position:absolute;bottom:0;left:0;right:0;font-family:var(--cond);font-size:11px;letter-spacing:1px;
  text-transform:uppercase;padding:6px 8px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--scrim) 85%,transparent));color:var(--on-scrim)}
.modal-photo.tappable,.proof-thumb.tappable{cursor:zoom-in}
.modal-photo.private{aspect-ratio:auto;min-height:120px}
.mp-priv{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:6px;padding:12px 10px 26px;color:var(--muted);text-align:center}
.mp-priv-check{width:18px;height:18px;border-radius:50%;background:var(--green);color:var(--on-green);
  display:grid;place-items:center}
.mp-priv-cap{font-size:11px;line-height:1.35;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;
  -webkit-box-orient:vertical;overflow:hidden}
.mp-expand{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:8px;z-index:2;
  background:color-mix(in srgb,var(--scrim) 60%,transparent);display:grid;place-items:center;color:#fff}

/* ── lightbox (full-screen photo viewer) ── */
.lightbox{position:fixed;inset:0;z-index:90;background:rgba(4,4,7,.97);display:flex;align-items:center;
  justify-content:center;touch-action:none;overscroll-behavior:contain}
.lb-img{max-width:100%;max-height:100%;will-change:transform}
.lb-img img{max-width:100vw;max-height:100vh;object-fit:contain;pointer-events:none;
  -webkit-user-select:none;user-select:none}
.lb-close{position:fixed;top:calc(12px + env(safe-area-inset-top));right:14px;width:40px;height:40px;
  border-radius:50%;background:rgba(255,255,255,.14);color:#fff;display:grid;place-items:center;z-index:2}
.lb-cap{position:fixed;bottom:calc(18px + env(safe-area-inset-bottom));left:0;right:0;text-align:center;
  font-family:var(--cond);letter-spacing:1px;text-transform:uppercase;color:var(--on-scrim-muted);font-size:11px;pointer-events:none}

/* tabbar */
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:40;max-width:600px;margin:0 auto;display:flex;
  padding:8px 8px calc(8px + env(safe-area-inset-bottom));gap:4px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 55%,transparent),color-mix(in srgb,var(--bg) 96%,transparent));backdrop-filter:blur(18px);
  border-top:1px solid var(--line)}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border-radius:14px;
  color:var(--muted-2);font-family:var(--cond);font-weight:600;font-size:10px;letter-spacing:1px;
  text-transform:uppercase;position:relative;transition:color .15s}
.tab.active{color:var(--text)}
.tab.active svg{color:var(--brand)}
.tab-badge{position:absolute;top:2px;right:50%;margin-right:-22px;min-width:17px;height:17px;border-radius:99px;
  background:var(--red);color:var(--on-red);font-size:10px;font-family:var(--sans);font-weight:700;display:grid;place-items:center;padding:0 4px}

/* login + onboarding */
.login-wrap{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;
  padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))}
.login-card{width:100%;max-width:400px}
.login-brand{text-align:center;margin-bottom:26px}
.login-brand .lb-mark{font-family:var(--display);font-size:56px;color:var(--brand);letter-spacing:2px;line-height:1}
.login-brand .lb-word{font-family:var(--cond);font-weight:700;font-size:22px;letter-spacing:6px;margin-top:-2px}
.login-brand .lb-sub{color:var(--muted);font-size:13px;margin-top:10px;letter-spacing:.3px}
.field{margin-bottom:10px}
.field label{display:block;font-family:var(--cond);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;
  color:var(--muted);margin:0 0 6px 2px}
.field input,.field select{width:100%;background:var(--panel);border:1px solid var(--line-2);border-radius:13px;padding:14px 15px;
  color:var(--text);font-size:15px}
.field input:focus{outline:none;border-color:var(--brand)}
.login-err{color:var(--red);font-size:13px;margin:8px 2px;text-align:center}
.login-note{text-align:center;color:var(--muted-2);font-size:11px;margin-top:16px;line-height:1.5}
.auth-flip{display:block;width:100%;text-align:center;color:var(--muted);font-size:13px;margin-top:14px;text-decoration:underline;text-underline-offset:3px}

.onb-wrap{max-width:600px;margin:0 auto;min-height:100vh;
  padding:calc(26px + env(safe-area-inset-top)) 18px calc(60px + env(safe-area-inset-bottom))}
.onb-choice{display:grid;gap:12px;margin-top:18px}
.onb-choice .card{cursor:pointer;transition:border-color .15s}
.onb-choice .card:hover{border-color:var(--line-2)}
.onb-title{font-family:var(--cond);font-weight:700;font-size:19px;letter-spacing:.5px;display:flex;align-items:center;gap:10px}
.onb-sub{color:var(--muted);font-size:13px;margin-top:4px;line-height:1.45}
.fmt-picker{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:2px}
.fmt-chip{display:flex;align-items:center;gap:8px;padding:12px;border-radius:12px;background:var(--panel);
  border:1px solid var(--line);color:var(--muted);font-family:var(--cond);font-weight:600;font-size:14px;
  letter-spacing:.5px}
.fmt-chip.active{border-color:var(--brand);color:var(--text);background:var(--panel-2)}
.fmt-chip.active svg{color:var(--brand)}
.builder-row{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);
  border-radius:13px;padding:9px 10px;margin-bottom:8px}
.builder-row input{background:transparent;border:none;color:var(--text);font-size:14px;min-width:0}
.builder-row input:focus{outline:none}
.builder-row .br-label{flex:1.2;font-weight:600}
.builder-row .br-hint{flex:1;color:var(--muted);font-size:12px}
.kind-toggle{flex:none;font-family:var(--cond);font-size:10px;letter-spacing:1px;text-transform:uppercase;
  padding:5px 9px;border-radius:8px;border:1px solid var(--line-2);color:var(--muted)}
.kind-toggle.photo{color:var(--blue);border-color:color-mix(in srgb,var(--blue) 50%,transparent);background:color-mix(in srgb,var(--blue) 8%,transparent)}
.kind-toggle.check{color:var(--purple);border-color:color-mix(in srgb,var(--purple) 50%,transparent);background:color-mix(in srgb,var(--purple) 8%,transparent)}
.br-del{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--muted-2)}
.br-del:hover{color:var(--red)}
.code-big{font-family:var(--display);font-size:52px;letter-spacing:10px;text-align:center;color:var(--gold);
  background:var(--panel);border:1px dashed color-mix(in srgb,var(--gold) 50%,transparent);border-radius:18px;padding:20px 10px;margin:14px 0}

.empty{text-align:center;color:var(--muted);padding:40px 20px}
.empty .e-ic{color:var(--muted-2);margin-bottom:10px}
.row-split{display:flex;gap:10px}
.row-split>*{flex:1}
.muted{color:var(--muted)}
.center{text-align:center}

/* ── colorway picker ── */
.avatar-btn{padding:0;display:grid;border-radius:50%}
.theme-opt{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border-radius:14px;
  border:1px solid var(--line);text-align:left;margin-bottom:8px}
.theme-opt.active{border-color:var(--line-2);background:var(--panel-2)}
.theme-opt .to-label{flex:1;font-family:var(--cond);font-weight:600;font-size:15px;letter-spacing:1px;text-transform:uppercase}
.theme-opt .to-check{color:var(--green)}
.voice-opt .to-label small,.priv-opt .to-label small{display:block;font-family:var(--sans);font-weight:400;font-size:12px;
  letter-spacing:0;text-transform:none;color:var(--muted);margin-top:2px}
.lock-pill{display:inline-flex;align-items:center;gap:4px;font-family:var(--cond);font-size:11px;font-weight:600;
  letter-spacing:.5px;padding:4px 9px;border-radius:999px;background:var(--panel-3);color:var(--muted)}
.lock-pill.on{background:color-mix(in srgb, var(--amber) 18%, transparent);color:var(--amber)}
.lock-opt .to-label{flex:1}
.theme-swatch{width:36px;height:36px;border-radius:11px;border:1px solid var(--line-2);flex:none;
  display:flex;gap:4px;align-items:center;justify-content:center}
.theme-swatch i{width:9px;height:9px;border-radius:50%;display:block}

/* ── colorways ── */
:root[data-theme="espresso"]{
  --bg:#120D0A; --panel:#1E1712; --panel-2:#261D16; --panel-3:#302419;
  --line:rgba(255,240,225,.08); --line-2:rgba(255,240,225,.16);
  --text:#F7F0E8; --muted:#A69486; --muted-2:#776557;
  --red:#FF6B57; --green:#3FD672; --gold:#FFCE54; --amber:#FFA24A; --blue:#6FA9FF; --purple:#C98BF2;
  --brand:#FF3B30; --on-accent:#1A120C; --ring:rgba(255,240,225,.1);
  --glow-1:#241511; --glow-2:#1E150E; --glow-fade:rgba(18,13,10,0);
}
:root[data-theme="navy"]{
  --bg:#070D17; --panel:#101A2A; --panel-2:#152135; --panel-3:#1C2A42;
  --line:rgba(210,230,255,.09); --line-2:rgba(210,230,255,.17);
  --text:#F2F6FC; --muted:#8FA2BA; --muted-2:#64778F;
  --red:#FF5C6C; --green:#2FD584; --gold:#FFD34D; --amber:#FFB020; --blue:#4DA3FF; --purple:#A78BFF;
  --brand:#FF3B30; --on-accent:#081020; --ring:rgba(210,230,255,.1);
  --glow-1:#131C33; --glow-2:#0C1F2E; --glow-fade:rgba(7,13,23,0);
}
:root[data-theme="sand"]{
  color-scheme:light;
  --bg:#EAE0CE; --panel:#F4EDDF; --panel-2:#EDE4D2; --panel-3:#DFD3BC;
  --line:rgba(62,48,35,.14); --line-2:rgba(62,48,35,.26);
  --text:#2E241B; --muted:#6A594A; --muted-2:#8D7C6A;
  --red:#B23A2E; --green:#276B3C; --gold:#7A5E0C; --amber:#9B5210; --blue:#2F5F8F; --purple:#79489B;
  --brand:#A9382A;
  --on-accent:#F7F0E2; --on-green:#F2F7EE; --on-amber:#FFF3E4; --ring:rgba(62,48,35,.18);
  --glow-1:#F3E7CD; --glow-2:#E7DCCB; --glow-fade:rgba(234,224,206,0);
  --gc-face1:#DDE8D2; --gc-face2:#C9DAC0; --gc-star:rgba(39,107,60,.9);
}
/* iOS standalone: white status text needs a dark seat on the light theme */
:root[data-theme="sand"] body::before{content:'';position:fixed;top:0;left:0;right:0;
  height:env(safe-area-inset-top);background:#241B12;z-index:98;pointer-events:none}
`
