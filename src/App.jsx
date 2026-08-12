import { useEffect, useMemo, useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { syncDailyReminder } from './lib/native.js'
import * as api from './data.js'
import { todayInTz, currentDayNumber, summarize, deriveFormat, isLogComplete } from './lib/challenge.js'
import { getStoredTheme, applyTheme, normalizeTheme, themeMode, mapAccent } from './theme.js'
import { copyFor, getStoredTone, storeTone, normalizeTone } from './copy.js'
import { AppCtx, useApp } from './appContext.js'
import Icon from './components/Icons.jsx'
import YouSheet from './components/YouSheet.jsx'
import ExportSheet from './components/ExportSheet.jsx'
import Landing from './components/Landing.jsx'
import Login from './components/Login.jsx'
import ResetPassword from './components/ResetPassword.jsx'
import OnboardCoach from './components/OnboardCoach.jsx'
import Today from './components/Today.jsx'
import Standings from './components/Standings.jsx'
import RenameSheet from './components/RenameSheet.jsx'
import EditChecklistSheet from './components/EditChecklistSheet.jsx'
import History from './components/History.jsx'
import Goals from './components/Goals.jsx'
import JudgeQueue from './components/JudgeQueue.jsx'

// Rides the signed-in tree so its hook order is stable: keeps the native
// daily reminder scheduled while a challenge is live, cleared otherwise.
// Renders nothing; no-op on the web.
// Every per-day number a plan can aim at. Weight fields are deliberately not
// here: those belong to a single body goal, not to the merged daily bar.
const TARGET_FIELDS = [
  'nutritionMode', 'proteinMin', 'proteinMax', 'calorieTarget',
  'fiberTarget', 'satFatMax', 'sodiumMax', 'sugarMax',
]

function ReminderSync({ on }) {
  useEffect(() => { syncDailyReminder(on) }, [on])
  return null
}

export default function App() {
  // Password-reset link target (youmode.app/reset?token=...) — handled before
  // any auth/boot logic so a logged-out visitor can set a new password.
  const [resetToken, setResetToken] = useState(() => {
    try {
      const u = new URL(window.location.href)
      if (u.pathname.replace(/\/$/, '') === '/reset') return u.searchParams.get('token') || null
    } catch { /* ignore */ }
    return null
  })
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
  const [exportOpen, setExportOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [editingList, setEditingList] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false) // building an ADDITIONAL challenge

  // Gate on userId: logged-out visitors keep the sunrise boot paint, and a
  // fresh visitor's mount must NOT persist 'midnight' to localStorage (that
  // would kill the sunrise first paint on their next visit).
  useEffect(() => { if (userId) applyTheme(theme) }, [theme, userId])
  useEffect(() => { if (userId) storeTone(tone) }, [tone, userId])
  useEffect(() => {
    // Sync the NORMALIZED profile theme (retired colorways remap, e.g.
    // blush→linen) and lazily write the remap back so the DB migrates itself
    // on first load after a retirement. No-op when nothing changed.
    const raw = bundle?.profile?.theme
    if (!raw) return
    const nt = normalizeTheme(raw)
    if (nt !== theme) setThemeState(nt)
    if (nt !== raw && userId) api.saveTheme(userId, nt).catch(() => {})
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
    // Load the bundle BEFORE flipping to the logged-in state, so we never
    // render the "can't reach the server" fallback in the gap between userId
    // being set and the data arriving (that gap was a ~1s error flash on login).
    await refresh(uid)
    setView('today')
    setUserId(uid)
  }, [refresh])

  const signOut = useCallback(async () => {
    await api.signOut()
    setUserId(null)
    setBundle(null)
  }, [])

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount() // server cascades + clears the local session
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
    // The day belongs to the person living it, not to the challenge's home
    // city. Someone running theirs from Paris is on Paris time, and someone
    // who goes to bed at 1am gets a boundary that is after they do.
    // bundle.profile, not `me`: that const is declared further down this
    // component and useMemo runs during render, so reaching for it here threw
    // "cannot access before initialization" and took the whole app to a blank
    // screen. Same object, available now.
    const prof = bundle?.profile
    const tz = prof?.timezone || c.timezone
    const endHour = prof?.dayEndHour || 0
    return {
      startStr: c.startDate,
      todayStr: todayInTz(tz, endHour),
      totalDays: c.totalDays,
      timezone: tz,
      challengeTimezone: c.timezone,
      dayEndHour: endHour,
      hasReferee: active.members.some((m) => m.role === 'referee'),
      format: c.format || deriveFormat(parts),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, nowTick, bundle?.profile?.timezone, bundle?.profile?.dayEndHour]) // nowTick keeps todayStr honest across the rollover

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
    uploadProof: api.uploadProof, clearPhotos: api.clearPhotos, setChecked: api.setChecked, setCheckCount: api.setCheckCount,
    saveNote: api.saveNote, verifySleep: api.verifySleep,
    saveCaption: api.saveCaption, estimateMeal: api.estimateMeal, logMealCaption: api.logMealCaption, addWeighIn: api.addWeighIn,
    dismissAiFlag: api.dismissAiFlag, reviewDay: api.reviewDay, useRedemption: api.useRedemption,
    goTo: setView, // lets a screen point at another tab (e.g. Today -> History)
    updateMyMember: api.updateMyMember, renameChallenge: api.renameChallenge, signedUrl: api.signedUrl,
    setReqPrivacy: api.setReqPrivacy,
  }), [refresh, signOut, switchChallenge])

  // Reset-password link wins over everything (even a live session).
  if (resetToken) {
    return (
      <>
        <style>{THEME}</style>
        <ResetPassword token={resetToken} onDone={() => {
          try { window.history.replaceState({}, '', '/') } catch { /* ignore */ }
          setResetToken(null)
        }} />
      </>
    )
  }

  if (booting) {
    return (
      <div className="app-bg">
        <style>{THEME}</style>
        <div className="splash">
          <span className="splash-brand">
            <img className="splash-logo" src="/logo-96.png" alt="" />
            <span className="splash-word">You Mode</span>
          </span>
        </div>
      </div>
    )
  }

  if (!userId) {
    // Web visitors get the marketing landing; the native app opens straight
    // on the auth flow, as App Store apps should. Login self-wraps in .lin.
    return (
      <>
        <style>{THEME}</style>
        {Capacitor.isNativePlatform() ? (
          <Login onAuthed={onAuthed} initialMode="signin" />
        ) : (
          <Landing onAuthed={onAuthed} />
        )}
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
          <span className="splash-brand" style={{ animation: 'none' }}>
            <img className="splash-logo" src="/logo-96.png" alt="" />
            <span className="splash-word">You Mode</span>
          </span>
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

  if (!active || creatingNew) {
    return (
      <>
        <style>{THEME}</style>
        <OnboardCoach profile={bundle.profile}
          onDone={async () => { await refresh(); setCreatingNew(false) }}
          onCancel={creatingNew ? () => setCreatingNew(false) : undefined}
          signOut={signOut}
          theme={theme} tone={tone} pickTheme={pickTheme} pickTone={pickTone} />
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

  // "Standings" reads like a competition — right for versus, wrong for a solo
  // run or a support crew (Miska). Rename by ACTUAL people: one person is always
  // "Progress" (even a versus that no one's joined yet); 2+ follows the format.
  const standingsLabel = participants.length <= 1 ? 'Progress'
    : cfg.format === 'versus' ? 'Standings' : 'Team'
  const tabs = [
    ...(!isReferee ? [['today', 'today', 'Today']] : []),
    ['standings', 'versus', standingsLabel],
    ...(isReferee ? [['judge', 'gavel', 'Judge']] : []),
    ['history', 'grid', 'History'],
    ...(anyGoals ? [['goals', 'target', 'Goals']] : []),
  ]
  const activeView = tabs.some(([k]) => k === view) ? view : tabs[0][0]

  const plans = active.plans || []
  const weighIns = active.weighIns || []
  const myPlans = plans.filter((p) => p.userId === me.id)
  const myPlan = myPlans[myPlans.length - 1] || null

  // Daily targets merge across plans, field by field: the newest plan that
  // sets a field owns that field, and a field nobody sets stays unset.
  //
  // Taking the newest plan whole was wrong. Adding "keep saturated fat under
  // 20g" wiped the protein and calorie targets that had been on the Today bar
  // a moment earlier, because the new plan simply had nothing in those slots.
  // Nobody asked for those to go away, so they don't.
  const myTargets = myPlans.reduce((acc, p) => {
    for (const k of TARGET_FIELDS) if (p[k] != null) acc[k] = p[k]
    return acc
  }, {})

  const ctx = {
    cfg, challenge: active.challenge, members: themedMembers, participants,
    requirements: active.requirements, logs: active.logs,
    plans, weighIns, myPlan, myPlans, myTargets,
    me, myMember, isReferee, summaries, reqsFor, logsFor, daysFor, maxDays, actions,
    t, tone,
    theme, mode: themeMode(theme), // 'soft' (Linen) | 'dark' — screens branch layout on this
    view: activeView, setView,
  }

  return (
    <AppCtx.Provider value={ctx}>
      <style>{THEME}</style>
      <div className="app-bg" />
      <div className="shell">
        <header className="topbar">
          {active.challenge.ownerId === me.id ? (
            <button className="brand brand-edit" title="Rename challenge" onClick={() => setRenaming(true)}>
              <span className="brand-name">{active.challenge.name}</span>
              <Icon name="edit" size={12} className="brand-edit-ic" />
            </button>
          ) : (
            <div className="brand" title={active.challenge.name}>
              <span className="brand-name">{active.challenge.name}</span>
            </div>
          )}
          {/* Nothing at all before day one: the Today screen already says
              "starts in 3 days" in the place you actually look (Miska). */}
          {dayNum >= 1 && (
            <div className="daypill">
              {dayNum > myDays ? <>COMPLETE</> : (
                <><span className="daypill-k">DAY</span><span className="daypill-n">{dayNum}</span><span className="daypill-t">/ {myDays}</span></>
              )}
            </div>
          )}
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

          </div>
        </header>
        {youOpen && (
          <YouSheet theme={theme} onPickTheme={pickTheme} tone={tone} onPickTone={pickTone}
            sharing={photoSharing} onPickSharing={pickPhotoSharing}
            photoReqs={reqsFor(me.id).filter((r) => r.kind === 'photo' && !api.isExtraMeal(r))}
            onToggleReq={async (reqId, next) => { await api.setReqPrivacy(reqId, next); await refresh() }}
            showPrivacy={!isReferee}
            email={me.email}
            username={me.username}
            displayName={me.displayName}
            timezone={me.timezone} challengeTimezone={active?.challenge?.timezone}
            dayEndHour={me.dayEndHour}
            onSaveDayClock={async (v) => { await api.saveDayClock(me.id, v); await refresh() }}
            onSaveName={async (v) => { await api.saveDisplayName(me.id, v); await refresh() }}
            onSaveEmail={async (v) => { await api.saveEmail(me.id, v); await refresh() }}
            onSignOut={signOut}
            onDeleteAccount={deleteAccount}
            onEditChecklist={!isReferee ? () => { setYouOpen(false); setEditingList(true) } : null}
            onNewChallenge={() => { setYouOpen(false); setCreatingNew(true) }}
            onExport={() => { setYouOpen(false); setExportOpen(true) }}
            onClose={() => setYouOpen(false)} />
        )}
        {exportOpen && <ExportSheet onClose={() => setExportOpen(false)} />}
        {editingList && (
          <EditChecklistSheet
            reqs={reqsFor(me.id).filter((r) => !api.isExtraMeal(r))}
            onSave={async (items) => {
              // Body-plan extra meal slots ride along untouched so the sync
              // (which deletes rows missing from the list) never drops them.
              const hidden = reqsFor(me.id).filter((r) => api.isExtraMeal(r))
              await api.syncMyRequirements(active.challenge.id, me.id, [...items, ...hidden])
              await refresh()
            }}
            onClose={() => setEditingList(false)} />
        )}
        {renaming && (
          <RenameSheet current={active.challenge.name}
            onSave={async (name) => { await api.renameChallenge(active.challenge.id, name); await refresh(); setRenaming(false) }}
            onClose={() => setRenaming(false)} />
        )}

        <ReminderSync on={!isReferee && dayNum <= myDays} />
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
    // Same completeness gate as the queue (isLogComplete) so the badge count
    // and the queue never disagree — and so weekly items are excluded too.
    if (l.status === 'pending' && isLogComplete(reqsFor(l.userId), l)) n++
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
  /* look-pack hooks: defaults mirror current values exactly, so existing
     themes are computed-identical; a theme block may override (e.g. Blush
     swaps titles/big numbers to a serif and tints stat surfaces pastel). */
  --title-font:var(--cond); --title-track:1px; --title-case:uppercase;
  --num-font:var(--display);
  --daypill-bg:var(--panel); --score-bg:var(--panel); --water-bg:var(--panel);
  --macro-bg:var(--panel); --goalcard-bg:var(--panel); --row-me-bg:var(--panel-2);
  /* ── Sunrise: first-impression brand (landing/auth/onboard ONLY). Scoped on
     purpose — never overridden per colorway, never consumed by in-app CSS. */
  --sun-bg:#130C08; --sun-card:#1E1410; --sun-line:rgba(255,214,190,.14);
  --sun-text:#FBF1E9; --sun-muted:#C9B2A4;
  --sun-brand:#FF7A55; --sun-brand-deep:#FF6B4A; --sun-amber:#FFB25C; --sun-gold:#FFD9A8;
  --sun-on-cta:#2A130B;
  --sun-glow-a:rgba(255,107,74,.30); --sun-glow-b:rgba(255,178,92,.16);
  --sun-grain-o:0.04;
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

/* ── Sunrise backdrop: landing, auth, guided start only ──
   z-index 0 (not -1) so it covers the colorway's #root background (e.g. a
   Sand user signing out, or picking a theme mid-onboarding); every other
   .sun-scope child is lifted above it. */
.sun-bg{position:fixed;inset:0;z-index:0;background:var(--sun-bg);overflow:hidden}
.sun-scope > *:not(.sun-bg){position:relative;z-index:1}
.sun-bg::before{content:'';position:absolute;inset:-20%;
  background:
    radial-gradient(90% 55% at 50% 108%, var(--sun-glow-a), transparent 62%),
    radial-gradient(70% 40% at 72% 96%, var(--sun-glow-b), transparent 60%);
  animation:sun-drift 26s ease-in-out infinite alternate;will-change:transform,opacity}
@keyframes sun-drift{
  0%{transform:translate3d(-2.5%,1.5%,0) scale(1);opacity:.85}
  100%{transform:translate3d(2.5%,-1.5%,0) scale(1.06);opacity:1}}
.sun-bg::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:var(--sun-grain-o);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.lp-reveal{opacity:0;transform:translateY(14px);animation:sun-rise .7s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes sun-rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){
  .sun-bg::before{animation:none}
  .lp-reveal{animation:none;opacity:1;transform:none}
}

.splash{height:100vh;display:flex;align-items:center;justify-content:center}
/* Boot splash: the You Mode brand lockup (logo + serif wordmark), breathing
   gently. Theme-adaptive via --text, so it reads on cream or navy alike. */
.splash-brand{display:inline-flex;flex-direction:column;align-items:center;gap:13px;
  animation:breath 1.9s ease-in-out infinite}
.splash-logo{width:58px;height:58px;border-radius:16px;display:block}
.splash-word{font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:27px;
  letter-spacing:.3px;color:var(--text)}
@keyframes breath{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.97)}50%{opacity:1;transform:scale(1.02)}}
@media (prefers-reduced-motion: reduce){ .splash-brand{animation:none;opacity:1} }

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
/* Owner can tap the challenge name in the header to rename it. */
button.brand{background:none;border:none;padding:0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.brand-edit-ic{color:var(--muted-2);flex:none;opacity:.7}
button.brand:active .brand-edit-ic{color:var(--brand);opacity:1}
.brand-mark{font-family:var(--display);font-size:26px;color:var(--brand);line-height:1;letter-spacing:1px}
.brand-word{font-family:var(--cond);font-weight:700;font-size:18px;letter-spacing:3px;color:var(--text)}
.rename-chip{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font:inherit}
.rename-chip svg{opacity:.6}
.rename-chip:active{color:var(--text)}
.daypill{display:flex;align-items:baseline;gap:6px;padding:7px 14px;white-space:nowrap;border:1px solid var(--line-2);
  border-radius:999px;background:var(--daypill-bg);font-family:var(--cond);letter-spacing:1px}
.daypill-k{font-size:11px;color:var(--muted);font-weight:600}
.daypill-n{font-family:var(--num-font);font-size:20px;line-height:1}
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
.screen-title{font-family:var(--title-font);font-weight:700;font-size:26px;letter-spacing:var(--title-track);text-transform:var(--title-case)}
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
  background:var(--score-bg);border:1px solid var(--line);border-radius:var(--r);padding:16px 8px;margin-bottom:14px}
.scoreboard.solo{grid-template-columns:1fr}
.scoreboard.grid{grid-template-columns:1fr 1fr}
.vs-col{text-align:center;padding:4px 8px}
.vs-name{font-family:var(--cond);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:15px;
  display:inline-flex;align-items:center;gap:7px}
.vs-dot{width:9px;height:9px;border-radius:50%}
.vs-day{font-family:var(--num-font);font-size:60px;line-height:.95;margin:6px 0 0}
.vs-day small{font-family:var(--cond);font-size:16px;color:var(--muted);font-weight:500}
.vs-row{display:flex;justify-content:center;gap:14px;margin-top:10px}
.vs-mini{text-align:center}
.vs-mini-n{font-family:var(--cond);font-weight:700;font-size:20px}
.vs-mini-l{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted-2)}
.vs-divider{display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:22px;
  color:var(--muted-2)}
.leaderboard{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:6px 4px}
.lb-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px}
.lb-row.me{background:var(--row-me-bg)}
.lb-rank{font-family:var(--display);font-size:15px;color:var(--muted-2);width:18px;text-align:center}
.lb-name{flex:1;font-family:var(--cond);font-weight:600;font-size:15px;letter-spacing:.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-streak{display:inline-flex;align-items:center;gap:3px;color:var(--amber);font-family:var(--cond);
  font-weight:600;font-size:13px}
.lb-days{font-family:var(--num-font);font-size:18px;line-height:1}
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
.tc-count{font-family:var(--num-font);font-size:24px;line-height:1}
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
.today-hero .h-day{font-family:var(--num-font);font-size:40px;line-height:1}
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
.macrobar{background:var(--macro-bg);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin-top:12px}
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
.pp-goal{font-family:var(--title-font);font-weight:600;font-size:19px;margin-bottom:10px}
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
  border:1px solid var(--line);background:var(--water-bg);cursor:pointer;width:100%;text-align:left}
.watertoggle .wt-box{width:30px;height:30px;border-radius:9px;border:2px solid var(--line-2);display:grid;
  place-items:center;flex:none;transition:.15s}
.watertoggle .wt-title{font-family:var(--cond);font-weight:600;font-size:15px}
.watertoggle .wt-hint{font-size:12px;color:var(--muted)}
/* Weekly-cadence items: the "This week" section (progress toward N/week) */
.watertoggle.wk.met{border-color:color-mix(in srgb,var(--green) 45%,transparent);background:color-mix(in srgb,var(--green) 8%,transparent)}
.wk-photo{margin-top:10px}
.wk-photo .slots-grid{margin-top:8px;grid-template-columns:1fr}
.wk-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px}
.wk-title{font-family:var(--cond);font-weight:600;font-size:15px;color:var(--text)}
.wk-badge{font-family:var(--cond);font-weight:600;font-size:11px;letter-spacing:.5px;text-transform:uppercase;
  color:var(--muted);padding:5px 10px;border-radius:99px;background:var(--panel-2);border:1px solid var(--line)}
.wk-badge.met{color:var(--green);border-color:color-mix(in srgb,var(--green) 40%,transparent);
  background:color-mix(in srgb,var(--green) 10%,transparent)}

.daybanner{margin-top:14px;padding:16px;border-radius:var(--r);text-align:center;border:1px solid var(--line)}
.daybanner.done{background:linear-gradient(180deg,color-mix(in srgb,var(--green) 16%,transparent),color-mix(in srgb,var(--green) 3%,transparent));border-color:color-mix(in srgb,var(--green) 40%,transparent)}
.daybanner.review{background:linear-gradient(180deg,color-mix(in srgb,var(--amber) 14%,transparent),color-mix(in srgb,var(--amber) 3%,transparent));border-color:color-mix(in srgb,var(--amber) 40%,transparent)}
.daybanner.rejected{background:linear-gradient(180deg,color-mix(in srgb,var(--red) 14%,transparent),color-mix(in srgb,var(--red) 3%,transparent));border-color:color-mix(in srgb,var(--red) 40%,transparent)}
.daybanner .db-title{font-family:var(--cond);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:16px}
.daybanner .db-sub{font-size:13px;color:var(--muted);margin-top:3px}

.ring{transform:rotate(-90deg)}
.ring-bg{stroke:var(--panel-3)}
.ring-label{font-family:var(--display);font-size:18px;fill:var(--text)}
/* Standings garnish: sole-leader crown (both modes) + soft-mode mini rings */
.lb-crown{color:var(--gold);margin-left:5px;vertical-align:-2px}
.miniring{flex:none}
/* Soft-mode Today hero (Linen layout) */
.soft-hero{display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0 4px;text-align:center}
.sh-ring{margin-top:2px}
.sh-day{font-family:var(--title-font);font-size:34px;font-weight:600;fill:var(--text)}
.sh-count{font-family:var(--cond);font-weight:600;font-size:12px;letter-spacing:2px;fill:var(--muted);text-transform:uppercase}
.sh-line{font-size:14.5px;color:var(--muted);max-width:300px;line-height:1.5;margin:0}
/* Day Complete celebration: above tabbar (40) + modal (60), below lightbox (90) */
.dc-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;
  padding:24px;background:color-mix(in srgb,var(--bg) 94%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.dc-card{position:relative;width:100%;max-width:340px;text-align:center;background:var(--panel);
  border:1px solid var(--line-2);border-radius:var(--r);padding:26px 22px 20px;
  box-shadow:0 24px 70px -20px rgba(0,0,0,.35);animation:dc-in .5s cubic-bezier(.2,.8,.2,1)}
@keyframes dc-in{from{opacity:0;transform:scale(.92) translateY(14px)}to{opacity:1;transform:none}}
.dc-eyebrow{display:inline-flex;align-items:center;gap:6px;font-family:var(--cond);font-weight:600;
  font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
.dc-eyebrow svg{color:var(--gold)}
.dc-title{font-family:var(--title-font);font-weight:600;font-size:40px;letter-spacing:var(--title-track);
  text-transform:var(--title-case);color:var(--text);margin:6px 0 14px;line-height:1.05}
.dc-ring{display:block;margin:0 auto}
.dc-arc{animation:dc-arc .9s cubic-bezier(.2,.8,.2,1)}
@keyframes dc-arc{from{stroke-dashoffset:351}to{stroke-dashoffset:0}}
.dc-check{font-size:34px;fill:var(--green)}
.dc-sub{font-size:14px;color:var(--muted);line-height:1.55;margin:14px 0 0}
.dc-streak{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:7px 14px;border-radius:99px;
  background:color-mix(in srgb,var(--amber) 12%,transparent);border:1px solid color-mix(in srgb,var(--amber) 30%,transparent);
  font-family:var(--cond);font-weight:600;font-size:13px;letter-spacing:.5px;color:var(--amber)}
.dc-brand{margin-top:14px;font-family:var(--cond);font-weight:700;font-size:10px;letter-spacing:3px;color:var(--muted-2)}
.dc-burst{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.dc-burst i{position:absolute;width:14px;height:14px;background:var(--gold);opacity:0;
  clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);
  animation:dc-pop 1.4s ease-out forwards}
.dc-burst i:nth-child(1){left:16%;top:24%;animation-delay:.15s}
.dc-burst i:nth-child(2){left:80%;top:20%;width:10px;height:10px;animation-delay:.3s}
.dc-burst i:nth-child(3){left:70%;top:58%;animation-delay:.45s;background:var(--green)}
.dc-burst i:nth-child(4){left:12%;top:62%;width:9px;height:9px;animation-delay:.55s}
.dc-burst i:nth-child(5){left:48%;top:12%;width:11px;height:11px;animation-delay:.7s;background:var(--green)}
.dc-burst i:nth-child(6){left:88%;top:42%;width:8px;height:8px;animation-delay:.85s}
@keyframes dc-pop{0%{opacity:0;transform:scale(.2) rotate(0)}25%{opacity:1}
  100%{opacity:0;transform:scale(1.5) rotate(90deg) translateY(-18px)}}
@media (prefers-reduced-motion: reduce){
  .dc-card,.dc-arc{animation:none}
  .dc-burst{display:none}
}

/* calendar / history */
.cal-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:5px}
.cal-cell{aspect-ratio:1/1;border-radius:6px;border:1px solid var(--line);display:grid;place-items:center;
  font-family:var(--cond);font-size:11px;color:var(--muted-2);position:relative;cursor:default}
.cal-cell.has{cursor:pointer}
.cal-cell.approved{background:color-mix(in srgb,var(--green) 85%,transparent);color:var(--on-green);border-color:transparent;font-weight:600}
.cal-cell.pending{background:color-mix(in srgb,var(--amber) 85%,transparent);color:var(--on-amber);border-color:transparent;font-weight:600}
.cal-cell.fail{background:color-mix(in srgb,var(--red) 85%,transparent);color:var(--on-red);border-color:transparent;font-weight:600}
.cal-cell.active{border-color:var(--text);color:var(--text);font-weight:600}
/* Redeemed day: clearly not a pass, clearly not a fail. Outlined rather than
   filled so it reads as "held" instead of "earned". */
.cal-cell.excused{background:color-mix(in srgb,var(--blue) 16%,transparent);
  border-color:color-mix(in srgb,var(--blue) 60%,transparent);color:var(--text);font-weight:600}
/* Awareness-mode macro row: a number, no bar, no verdict. */
.mb-row.plain{justify-content:space-between}
.mb-more{background:none;border:none;color:var(--muted);font-family:var(--cond);font-size:11px;
  letter-spacing:.12em;text-transform:uppercase;display:inline-flex;align-items:center;gap:3px;
  padding:4px 0 0;cursor:pointer;align-self:flex-start}
/* Blood work: the reviewable marker list, shown in the coach thread. */
.lab-list{display:flex;flex-direction:column;gap:6px;max-height:46vh;overflow-y:auto}
/* Meal stats over the photo: what the app estimated for this plate. */
.lb-stats{position:absolute;left:0;right:0;bottom:52px;padding:14px 16px 12px;z-index:3;
  background:linear-gradient(to top,rgba(10,9,8,.94),rgba(10,9,8,.7) 70%,transparent);color:#f2ece3}
.lbs-cap{font-size:13px;line-height:1.45;margin-bottom:10px;opacity:.92}
.lbs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px 6px}
.lbs-item{display:flex;flex-direction:column;gap:1px}
.lbs-item b{font-family:var(--num-font,var(--cond));font-size:17px;line-height:1.1}
.lbs-item span{font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
.lbs-note{font-size:10.5px;opacity:.5;margin-top:9px}
/* Progress reel: day one beside today, then everything in between. */
.pr-entry .gc-ic{color:var(--brand)}
.pr-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pr-pair figure{margin:0;position:relative;aspect-ratio:3/4;border-radius:var(--r);overflow:hidden;background:var(--panel-2)}
.pr-pair figure img{width:100%;height:100%;object-fit:cover;display:block}
.pr-pair figcaption{position:absolute;left:0;right:0;bottom:0;padding:14px 8px 6px;color:#fff;font-size:12px;
  font-weight:650;text-align:center;background:linear-gradient(to top,rgba(0,0,0,.6),transparent)}
.pr-strip{display:flex;gap:6px;overflow-x:auto;margin:12px 0 8px;padding-bottom:4px;scrollbar-width:none}
.pr-strip::-webkit-scrollbar{display:none}
.pr-thumb{position:relative;flex:0 0 52px;height:66px;padding:0;border:2px solid transparent;border-radius:8px;
  overflow:hidden;background:var(--panel-2);cursor:pointer}
.pr-thumb img{width:100%;height:100%;object-fit:cover;display:block;opacity:.55}
.pr-thumb.on{border-color:var(--brand)}
.pr-thumb.on img{opacity:1}
.pr-thumb span{position:absolute;left:0;right:0;bottom:0;font-size:9px;color:#fff;text-align:center;
  background:rgba(0,0,0,.55);padding:1px 0}
.pr-scrub{display:flex;align-items:center;gap:8px}
.pr-scrub input{flex:1;accent-color:var(--brand)}
/* Waiting for day one: the countdown, a real date, and a look at the list. */
.notyet{padding:26px 0 8px;text-align:center}
.notyet .e-ic{opacity:.55;margin-bottom:10px}
.ny-count{font-family:var(--cond);font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  font-size:12px;color:var(--brand)}
.notyet > p{margin:6px auto 0;max-width:32ch;font-size:14px;line-height:1.6}
.ny-peek{margin-top:26px;text-align:left;opacity:.72}
.ny-peek .section-label{justify-content:flex-start}
.slot.preview,.watertoggle.preview{pointer-events:none}
.br-group{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted)}
.br-group-in{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;
  padding:5px 9px;color:var(--text);font:inherit;font-size:12px}
.br-sleep label{white-space:nowrap}
/* A group of small checks in one tile. */
.grp{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;margin-bottom:8px}
.grp-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.grp-name{font-weight:650;font-size:15px;flex:1}
.grp-count{font-size:12px;color:var(--muted)}
.grp-count.met{color:var(--green)}
.grp-items{display:flex;flex-wrap:wrap;gap:6px}
.grp-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:999px;
  border:1px solid var(--line);background:var(--panel-2);color:var(--muted);font:inherit;font-size:13px;cursor:pointer}
.grp-chip.on{border-color:var(--blue);color:var(--text);background:color-mix(in srgb,var(--blue) 12%,transparent)}
.grp-chip .gc-box{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--line-2);display:grid;place-items:center;flex:none}
.grp-chip.on .gc-box{background:var(--blue);border-color:var(--blue);color:#fff}
/* Note items: the question, your last answer, and room to write. */
.noterow{text-align:left}
.note-prev{background:var(--panel-2);border-left:2px solid var(--line-2);border-radius:0 10px 10px 0;
  padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.5;color:var(--muted)}
.np-when{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted-2);margin-bottom:4px}
.note-in{width:100%;resize:vertical;line-height:1.5}
/* Deadlines and reordering on a checklist row. */
.br-move{display:inline-flex;gap:2px;margin-left:auto;margin-right:4px}
.br-move button{width:26px;height:26px;display:grid;place-items:center;border-radius:7px;
  border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer}
.br-move button:disabled{opacity:.3}
.br-due{display:flex;align-items:center;gap:8px;margin:8px 0 0;font-size:12px;color:var(--muted)}
.br-due-add{background:none;border:1px dashed var(--line-2);border-radius:999px;padding:5px 11px;
  color:var(--muted);font:inherit;font-size:12px;cursor:pointer}
.br-due-in{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:5px 8px;
  color:var(--text);font:inherit;font-size:12px}
.br-due-say{font-weight:600;color:var(--text)}
.br-due-x{background:none;border:none;color:var(--muted-2);cursor:pointer;display:flex;padding:2px}
/* Today: a deadline on the tile, and the mark when it slipped. */
.slot-due{position:absolute;left:10px;top:10px;z-index:4}
.due-pill{display:inline-flex;align-items:center;gap:3px;font-size:10px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 7px}
.due-pill.late{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 45%,transparent)}
.de-row{display:flex;flex-wrap:wrap;gap:6px}
.de-chip{padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:var(--panel);
  color:var(--muted);font:inherit;font-size:13px;cursor:pointer}
.de-chip.on{border-color:var(--brand);color:var(--text);background:var(--panel-2)}
/* Photo options: what to do with a shot you already took. */
.pm-wrap{position:fixed;inset:0;z-index:120;background:color-mix(in srgb,var(--scrim) 60%,transparent);
  display:flex;align-items:flex-end;justify-content:center;animation:pmfade .14s ease}
@keyframes pmfade{from{opacity:0}to{opacity:1}}
.pm{width:100%;max-width:520px;margin:8px;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r);overflow:hidden;padding-bottom:env(safe-area-inset-bottom);
  animation:pmup .18s cubic-bezier(.2,.9,.3,1)}
@keyframes pmup{from{transform:translateY(14px)}to{transform:translateY(0)}}
.pm-head{padding:12px 16px 10px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);border-bottom:1px solid var(--line)}
.pm-item{display:flex;align-items:center;gap:12px;width:100%;padding:15px 16px;background:none;border:none;
  border-bottom:1px solid var(--line);color:var(--text);font:inherit;font-size:15px;text-align:left;cursor:pointer}
.pm-item:active{background:var(--panel-2)}
.pm-item small{margin-left:auto;font-size:11px;color:var(--muted)}
.pm-item.danger{color:var(--red)}
.pm-cancel{width:100%;padding:15px 16px;background:none;border:none;color:var(--muted);
  font:inherit;font-size:15px;font-weight:600;cursor:pointer}
/* Daily-targets card: chips, no weight furniture. */
.tg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 8px}
.lab-row{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:var(--r-sm);
  background:var(--panel-2);border:1px solid transparent}
.lab-row.flag{border-color:color-mix(in srgb,var(--amber) 50%,transparent);
  background:color-mix(in srgb,var(--amber) 8%,transparent)}
.lab-row .lr-name{flex:1;font-size:13px}
.lab-row .lr-val{font-size:13px;color:var(--muted);white-space:nowrap}
.lab-row .lr-val b{color:var(--text);font-size:14px}
.lab-row .lr-val small{font-size:11px}
.lr-x{background:none;border:none;color:var(--muted-2);cursor:pointer;padding:2px;display:flex}
/* Attach lives in the composer, so handing over a file is the same gesture
   as saying something. */
.coach-clip{display:flex;align-items:center;justify-content:center;flex:0 0 auto;
  width:34px;height:34px;border-radius:50%;color:var(--muted);cursor:pointer}
.coach-clip:active{background:var(--panel-2)}
.coach-clip input{display:none}
.coach-labs{display:flex;align-items:center;gap:7px;padding:6px 14px;font-size:12px;
  color:var(--muted);border-bottom:1px solid var(--line)}
.coach-labs span{flex:1}
.lab-draft-head{display:flex;align-items:center;gap:10px;margin:2px 0 10px;
  font-size:12px;color:var(--muted);line-height:1.45}
.lab-draft-head .lab-date{flex:0 0 auto;width:auto;font-size:12px;padding:5px 8px}
/* Reading a panel takes 20 seconds or so. A still bubble that long reads as
   frozen, so the bar keeps moving and the line says where we are. */
.lab-bar{height:3px;border-radius:2px;background:var(--panel-2);overflow:hidden;margin-bottom:12px}
.lab-bar i{display:block;height:100%;width:38%;border-radius:2px;background:var(--brand);
  animation:labslide 1.5s ease-in-out infinite}
@keyframes labslide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
@media (prefers-reduced-motion:reduce){.lab-bar i{animation:none;width:100%;opacity:.4}}
/* Export sheet: a compact row of what's about to leave the app. */
.ex-stats{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--muted)}
.ex-stats b{color:var(--text);font-family:var(--num-font,var(--cond));font-size:15px;margin-right:3px}
/* Today nudge: a still-saveable day, pointed at from where people look. */
.save-nudge{display:flex;align-items:center;gap:10px;width:100%;text-align:left;margin:12px 0 0;
  padding:11px 14px;border-radius:var(--r-sm);cursor:pointer;color:var(--text);
  background:color-mix(in srgb,var(--blue) 10%,transparent);
  border:1px solid color-mix(in srgb,var(--blue) 40%,transparent)}
.save-nudge .sn-txt{flex:1;font-size:13.5px}
/* The one-save offer on a failed day. */
.save-offer{display:flex;align-items:center;gap:12px;width:100%;text-align:left;margin-bottom:12px;
  padding:13px 14px;cursor:pointer;border-color:color-mix(in srgb,var(--blue) 45%,transparent)}
.save-offer .so-txt{flex:1;display:flex;flex-direction:column;gap:2px}
.save-offer .so-txt b{font-size:14px}
.save-offer .so-txt small{color:var(--muted);font-size:12px;line-height:1.35}
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
.goal-card{background:var(--goalcard-bg);border:1px solid var(--line);border-radius:var(--r);padding:18px;margin-bottom:12px;
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
.goal-name{font-family:var(--title-font);font-weight:700;font-size:18px;letter-spacing:.5px}
/* Editable professional-goal name: label with a hover pencil, or an inline editor. */
.goal-label-row{display:flex;align-items:center;gap:8px}
.goal-edit-btn{flex:none;width:24px;height:24px;border-radius:7px;display:grid;place-items:center;
  color:var(--muted-2);border:1px solid transparent}
.goal-edit-btn:hover{color:var(--text);border-color:var(--line-2)}
.goal-name-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.goal-name-edit input{flex:1;min-width:140px;background:var(--panel);border:1px solid var(--line-2);border-radius:10px;
  padding:9px 11px;color:var(--text);font-size:14px}
.goal-name-edit input:focus{outline:none;border-color:color-mix(in srgb,var(--brand) 55%,transparent)}
.lin .goal-name-edit input{background:var(--lpc-card);border-color:var(--lpc-line);color:var(--lpc-ink)}
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
/* ── Landing (lp2) + first-run (.lin): editorial system in the Linen language.
   Self-contained palette (logged-out pages can't rely on data-theme vars);
   shared by the landing and every cream first-run surface. ── */
.lp2,.lin{--lpc-bg:#F2ECDF;--lpc-card:#FBF6EA;--lpc-ink:#1E1810;--lpc-mut:#6E6151;
  --lpc-line:rgba(42,32,20,.14);--lpc-sage:#C15A34;--lpc-gold:#B0862C;--lpc-red:#9A3B2B}
/* Ink ramble: the voice moment goes dark. Overriding --lpc-* on the wrapper
   retints every .lin element that reads them; the two hardcoded bits (primary
   button text, mic gradient) get explicit dark-friendly overrides. */
.lin.oc-ink{--lpc-bg:#14110D;--lpc-card:#1F1A13;--lpc-ink:#EFE7D8;--lpc-mut:#A99C88;
  --lpc-line:rgba(239,231,216,.14);--lpc-sage:#D2794A;--lpc-gold:#E0B25A;--lpc-red:#E0714E;color-scheme:dark}
.lin.oc-ink .btn-accent{color:#171209}
.lin.oc-ink .oc-mic{background:linear-gradient(180deg,#D2794A,#B05A34);box-shadow:0 14px 40px -10px rgba(210,121,74,.45)}
.lin.oc-ink .oc-chatbar textarea::placeholder,.lin.oc-ink .field input::placeholder{color:#8A8073}
.lp2{background:var(--lpc-bg);color:var(--lpc-ink);min-height:100dvh}
/* Live mode preview: tapping a card flips the whole page. Overriding --lpc-*
   on .lp2.lp2-ink retints every token-based element in one shot; a transition
   on the color-bearing surfaces turns the flip into a crossfade. */
.lp2.lp2-ink{--lpc-bg:#14110D;--lpc-card:#1F1A13;--lpc-ink:#EFE7D8;--lpc-mut:#A99C88;
  --lpc-line:rgba(239,231,216,.15);--lpc-sage:#D2794A;--lpc-gold:#E0B25A;--lpc-red:#E0714E;color-scheme:dark}
.lp2,.lp2-nav,.lp2-word,.lp2-login,.lp2 h1,.lp2 h2,.lp2-sub,.lp2-p,.lp2-cta,.lp2-foot,.lp2-foot a,
.lpm-frame,.lpm-screen,.lpm-tile,.lpm-date,.lpm-line,.tg-card,.tg-media,.tg-card figcaption,
.lpm-day,.lpm-count,.lp2 section.lp2-dark,.lp2-dark h2,.lp2-dark .lp2-p{
  transition:background-color .5s ease,color .5s ease,border-color .5s ease,fill .5s ease}
.lp2-ink .lp2-cta{color:#171209}
.lp2-ink .lp2-cta:hover{background:#E3D8C3}
.lp2-nav{position:sticky;top:0;z-index:6;display:flex;align-items:center;justify-content:space-between;
  padding:calc(12px + env(safe-area-inset-top)) 22px 12px;
  background:color-mix(in srgb,var(--lpc-bg) 82%,transparent);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border-bottom:1px solid color-mix(in srgb,var(--lpc-ink) 6%,transparent)}
.lp2-brand{display:inline-flex;align-items:center;gap:9px}
.lp2-logo{width:26px;height:26px;border-radius:8px;display:block}
.lp2-word{font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:19px}
.lp2-login{font-family:var(--cond);font-weight:600;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;
  color:var(--lpc-mut);background:none;border:1px solid var(--lpc-line);border-radius:99px;padding:8px 16px;cursor:pointer}
.lp2 section{padding:76px 24px;max-width:640px;margin:0 auto;text-align:center}
.lp2-hero{padding-top:60px}
.lp2-eyebrow{font-family:var(--cond);font-weight:600;font-size:12px;letter-spacing:3px;text-transform:uppercase;
  color:var(--lpc-sage);margin:0 0 16px}
.lp2 h1{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:clamp(40px,11vw,72px);
  line-height:1.06;letter-spacing:-.5px;margin:0}
.lp2 h2{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:clamp(30px,8vw,48px);
  line-height:1.1;margin:0 0 12px}
.lp2-sub{font-size:16.5px;line-height:1.6;color:var(--lpc-mut);max-width:430px;margin:18px auto 0;text-wrap:balance}
.lp2-p{font-size:15px;line-height:1.65;color:var(--lpc-mut);max-width:400px;margin:0 auto}
.lp2-cta-row{display:flex;justify-content:center;margin-top:28px}
.lp2-cta{font-family:var(--cond);font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;
  color:#FBF7EE;background:var(--lpc-ink);border:none;border-radius:99px;padding:17px 44px;cursor:pointer;
  transition:transform .15s ease}
.lp2-cta:active{transform:scale(.97)}
.lp2-cta:hover{background:#20241B}
/* Phone mock: a little Linen Today screen — the product is the hero image */
.lpm{margin:54px auto 0;width:min(292px,78vw)}
.lpm-frame{background:#20241B;border-radius:44px;padding:11px;box-shadow:0 34px 80px -26px rgba(32,36,27,.5)}
.lpm-screen{background:var(--lpc-bg);border-radius:34px;padding:16px 16px 20px;overflow:hidden}
.lpm-screen::before{content:'';display:block;width:72px;height:8px;border-radius:99px;background:#20241B;margin:0 auto 16px;opacity:.9}
.lpm-date{font-family:var(--cond);font-weight:600;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;
  color:var(--lpc-mut);text-align:center}
.lpm-ring{display:block;margin:12px auto 4px}
/* The terracotta ring draws itself once on load, so the product feels alive. */
.lpm-ring circle:nth-of-type(2){animation:lpm-draw 1.2s cubic-bezier(.35,0,.15,1) .95s both}
@keyframes lpm-draw{from{stroke-dashoffset:289}to{stroke-dashoffset:96}}
.lpm-day{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:24px;fill:var(--lpc-ink)}
.lpm-count{font-family:var(--cond);font-weight:600;font-size:9px;letter-spacing:1.5px;fill:var(--lpc-mut)}
.lpm-line{font-size:11.5px;color:var(--lpc-mut);text-align:center;margin:0 0 14px}
.lpm-tile{display:flex;align-items:center;gap:9px;background:var(--lpc-card);border:1px solid var(--lpc-line);
  border-radius:14px;padding:11px 12px;margin-top:8px;font-size:12.5px;font-weight:600;color:var(--lpc-ink);text-align:left}
.lpm-tile>svg{color:var(--lpc-sage);flex:none}
.lpm-check{margin-left:auto;width:20px;height:20px;border-radius:50%;flex:none;
  background:var(--lpc-sage);color:#fff;display:grid;place-items:center}
.lpm-tile.todo .lpm-check{background:transparent;border:1.5px solid var(--lpc-line)}
/* Dark voice section: full-bleed sunrise ember with the breathing aura. The
   section.lp2-dark specificity is deliberate: it has to beat the .lp2 section
   640px cap, or the band floats as a marooned box on desktop. */
.lp2 section.lp2-dark{max-width:none;background:#14110D;position:relative;overflow:hidden;padding:96px 24px}
.lp2-dark .lp2-inner{max-width:640px;margin:0 auto;position:relative;z-index:1}
.lp2-dark h2{color:#EFE7D8}
.lp2-dark .lp2-p{color:#A99C88}
/* Halftone corner — a whisper of the logo's stipple, faded on the diagonal. */
.lp2-dark::after{content:'';position:absolute;top:0;right:0;width:230px;height:230px;pointer-events:none;z-index:0;
  background-image:radial-gradient(#EFE7D8 1.1px,transparent 1.2px);background-size:9px 9px;
  -webkit-mask-image:linear-gradient(225deg,rgba(0,0,0,.5),transparent 62%);mask-image:linear-gradient(225deg,rgba(0,0,0,.5),transparent 62%)}
.lp2-aura{position:absolute;inset:0;pointer-events:none}
.lp2-aura i{position:absolute;left:50%;top:44%;width:min(140vw,620px);aspect-ratio:1;
  transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle, color-mix(in srgb,#D2794A 20%,transparent) 0%, transparent 62%);
  animation:aura-breathe 3.4s ease-in-out infinite}
.lp2-aura i:nth-child(2){width:min(100vw,470px);animation-delay:-1.7s;
  background:radial-gradient(circle, color-mix(in srgb,#E0B25A 13%,transparent) 0%, transparent 60%)}
.lp2-orb{width:88px;height:88px;border-radius:50%;margin:0 auto 28px;display:grid;place-items:center;color:#FBF3EA;
  background:linear-gradient(180deg,#D2794A,#B05A34);box-shadow:0 14px 44px -8px rgba(210,121,74,.5)}
/* Track grid: three ways a finished goal can look — photo, check, note.
   Shows the "track it your way" idea instead of stating it. */
.lp2-tg{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:400px;margin:0 auto 34px}
.tg-card{display:flex;flex-direction:column;align-items:center;gap:11px;margin:0}
.tg-media{position:relative;width:100%;aspect-ratio:1;border-radius:18px;display:grid;place-items:center;
  background:var(--lpc-card);border:1px solid var(--lpc-line);box-shadow:0 16px 34px -22px rgba(32,36,27,.5)}
.tg-card figcaption{font-family:var(--cond);font-weight:500;font-size:11px;letter-spacing:.3px;
  color:var(--lpc-mut);text-align:center;line-height:1.35;max-width:96px}
/* photo tile: warm gradient "print" with a camera chip */
.tg-photo{background:linear-gradient(150deg,#D9C2A2,#B98A61);border-color:transparent}
.tg-cam{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#FBF3EA;
  background:rgba(30,22,14,.34);backdrop-filter:blur(2px)}
/* check tile: the whole tile is the win */
.tg-check{color:var(--lpc-sage)}
/* meal tile: a plate, logged */
.tg-meal{color:var(--lpc-mut)}
.tg-done{position:absolute;bottom:8px;right:8px;width:19px;height:19px;border-radius:50%;
  background:var(--lpc-sage);color:#FBF3EA;display:grid;place-items:center;
  box-shadow:0 0 0 3px var(--lpc-bg)}
/* Two moods split */
.lp2-modes-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:28px}
/* Mode cards double as the live toggle: fixed swatch colors (each always
   previews its own mode), a clear active ring, tactile press. */
.lp2-mode{border-radius:20px;padding:28px 14px;border:1px solid transparent;cursor:pointer;
  text-align:center;transition:transform .15s ease,box-shadow .2s ease}
.lp2-mode:active{transform:scale(.98)}
.lp2-mode.active{box-shadow:0 0 0 2px var(--lpc-sage)}
.lp2-mode b{display:block;font-size:19px;font-weight:600;margin-bottom:5px}
.lp2-mode span{display:block;font-size:12px;line-height:1.45}
.lp2-mode.linen{background:#FBF6EA;border-color:rgba(42,32,20,.14);color:#1E1810}
.lp2-mode.linen b{font-family:'Playfair Display',Georgia,serif}
.lp2-mode.linen span{color:#6E6151}
.lp2-mode.navy{background:#14110D;border-color:#14110D;color:#EFE7D8}
.lp2-mode.navy b{font-family:var(--cond);text-transform:uppercase;letter-spacing:2.5px}
.lp2-mode.navy span{color:#A99C88}
/* The "Just talk" band is the constant contrast beat: dark on Paper, inverted
   to cream on Ink, so there's always exactly one opposite section. */
.lp2-ink section.lp2-dark{background:#F2ECDF}
.lp2-ink .lp2-dark h2{color:#1E1810}
.lp2-ink .lp2-dark .lp2-p{color:#6E6151}
.lp2-ink .lp2-dark::after{background-image:radial-gradient(#17130E 1.1px,transparent 1.2px)}
/* Closing poster: the logo as art, once, big, above the final call. */
.lp2-final{padding-bottom:44px;border-top:1px solid var(--lpc-line)}
.lp2-final-mark{width:130px;height:130px;border-radius:30px;display:block;margin:6px auto 22px}
.lp2 ::selection{background:color-mix(in srgb,#C15A34 26%,transparent);color:#17130E}
.lp2-dark ::selection{background:color-mix(in srgb,#D2794A 34%,transparent);color:#14110D}
.lp2-foot{padding:6px 24px calc(30px + env(safe-area-inset-bottom));text-align:center;color:var(--lpc-mut);font-size:12px}
.lp2-foot a{color:var(--lpc-mut)}
/* Scroll-in reveals */
.lp2-io{opacity:0;transform:translateY(22px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.8,.2,1)}
.lp2-io.in{opacity:1;transform:none}
@media (min-width:720px){
  .lp2 section{padding:110px 24px}
  .lp2-hero{padding-top:84px}
  .lpm{width:320px}
  /* the ember band is now edge-to-edge, so grow the glow to fill it and give
     the scene real vertical room instead of a squat letterbox */
  .lp2 section.lp2-dark{padding:150px 24px}
  .lp2-aura i{width:min(95vw,1180px);top:50%}
  .lp2-aura i:nth-child(2){width:min(72vw,860px)}
}
@media (prefers-reduced-motion: reduce){
  .lp2-io{opacity:1;transform:none;transition:none}
  .lp2-aura i{animation:none;opacity:.6}
  .lpm-ring circle:nth-of-type(2){animation:none}
}

/* ── .lin: the cream first-run scope (auth, reset, review side of onboarding).
   Mirrors .sun-scope's fixed-bg + z-lift pattern. color-scheme:light matters:
   a signed-out device can still carry a dark data-theme, and without it iOS
   renders dark keyboards and selects over the cream. ── */
.lin{min-height:100dvh;color:var(--lpc-ink);color-scheme:light}
.lin-bg{position:fixed;inset:0;z-index:0;background:var(--lpc-bg)}
.lin > *:not(.lin-bg){position:relative;z-index:1}
/* cream twins of the .sun-scope overrides — additive, base rules untouched */
.lin .field label{color:var(--lpc-mut)}
.lin .field input,.lin .field select{background:var(--lpc-card);border-color:var(--lpc-line);color:var(--lpc-ink)}
.lin .field input:focus{border-color:var(--lpc-sage)}
.lin .field input::placeholder{color:#94988A}
.lin input:-webkit-autofill{-webkit-box-shadow:0 0 0 40px var(--lpc-card) inset;-webkit-text-fill-color:var(--lpc-ink)}
.lin .btn{background:transparent;border-color:var(--lpc-line);color:var(--lpc-ink)}
.lin .btn-accent{background:var(--lpc-ink);border-color:var(--lpc-ink);color:#FBF7EE;border-radius:99px}
.lin .btn-go{background:var(--lpc-sage);border-color:var(--lpc-sage);color:#fff}
.lin .auth-flip,.lin .login-note,.lin .lb-back{color:var(--lpc-mut)}
.lin .login-err{color:var(--lpc-red)}
.lin .screen-title{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:28px;
  letter-spacing:0;text-transform:none;color:var(--lpc-ink)}
.lin .muted,.lin .section-label{color:var(--lpc-mut)}
.lin .onb-wrap{color:var(--lpc-ink)}
.lin .onb-dots i{background:color-mix(in srgb,var(--lpc-ink) 14%,transparent)}
.lin .onb-dots i.on{background:var(--lpc-sage)}
.lin .fmt-chip{background:var(--lpc-card);border-color:var(--lpc-line);color:var(--lpc-mut)}
.lin .fmt-chip.active{border-color:var(--lpc-sage);color:var(--lpc-ink);background:var(--lpc-card)}
.lin .fmt-chip.active svg{color:var(--lpc-sage)}
.lin .builder-row{background:var(--lpc-card);border-color:var(--lpc-line)}
.lin .builder-row input{color:var(--lpc-ink)}
.lin .kind-toggle.photo{color:#4E6E8E;border-color:rgba(78,110,142,.5);background:rgba(78,110,142,.08)}
.lin .kind-toggle.check{color:#8A6E9E;border-color:rgba(138,110,158,.5);background:rgba(138,110,158,.08)}
.lin .br-del{color:var(--lpc-mut)}
.lin .oc-stepper{background:var(--lpc-card);border-color:var(--lpc-line)}
.lin .oc-stepper button{color:var(--lpc-mut)}
.lin .oc-step-n{color:var(--lpc-ink)}
.lin .theme-opt{background:var(--lpc-card);border:1px solid var(--lpc-line)}
/* Selection tint stays inside the cream palette — the base .active uses
   var(--panel-2), which is the GLOBAL theme's dark panel and turned selected
   cards dark-on-dark once a user picked Ink. */
.lin .theme-opt.active{border-color:var(--lpc-sage);background:color-mix(in srgb,var(--lpc-sage) 10%,var(--lpc-card))}
.lin .theme-opt .to-label{color:var(--lpc-ink)}
.lin .voice-opt .to-label small{color:var(--lpc-mut)}
.lin .theme-opt .to-check{color:var(--lpc-sage)}
.lin .code-big{color:var(--lpc-gold);background:var(--lpc-card);
  border-color:color-mix(in srgb,var(--lpc-gold) 45%,transparent)}
/* staged auth flow */
.au-wrap{max-width:440px;margin:0 auto;min-height:100dvh;
  padding:calc(14px + env(safe-area-inset-top)) 24px calc(28px + env(safe-area-inset-bottom))}
.au-top{position:relative;display:flex;align-items:center;justify-content:center;padding:8px 0 30px}
.au-brand{display:inline-flex;align-items:center;gap:9px}
.au-logo{width:26px;height:26px;border-radius:8px;display:block}
.au-word{font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:19px;color:var(--lpc-ink)}
.au-back{position:absolute;left:-8px;top:2px;padding:8px 10px;color:var(--lpc-mut);background:none;border:none;
  font-family:var(--cond);font-weight:600;font-size:13px;letter-spacing:1px;text-transform:uppercase;cursor:pointer}
.au-step{animation:au-in .45s cubic-bezier(.2,.8,.2,1) both}
@keyframes au-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.au-greet{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:17px;
  color:var(--lpc-sage);margin:0 0 10px}
.au-q{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:clamp(30px,8.5vw,40px);
  line-height:1.12;color:var(--lpc-ink);margin:0 0 10px}
.au-sub{font-size:14.5px;line-height:1.6;color:var(--lpc-mut);margin:0 0 22px;max-width:340px}
.au-ghost{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
@media (prefers-reduced-motion:reduce){.au-step{animation:none}}

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
/* Sunrise auth overrides — active only inside .sun-scope (landing/native) */
.sun-scope .lb-mark{color:var(--sun-brand)}
.sun-scope .lb-word{color:var(--sun-text)}
.sun-scope .lb-sub{color:var(--sun-muted)}
.sun-scope .field label{color:var(--sun-muted)}
.sun-scope .field input{background:var(--sun-card);border-color:var(--sun-line);color:var(--sun-text)}
.sun-scope .field input:focus{border-color:var(--sun-brand)}
.sun-scope .btn-accent{background:linear-gradient(180deg,#FF9A6A,#FF6B4A);border-color:transparent;
  color:var(--sun-on-cta);box-shadow:0 8px 28px rgba(255,107,74,.28), inset 0 1px 0 rgba(255,255,255,.25)}
.sun-scope .auth-flip,.sun-scope .login-note{color:var(--sun-muted)}
.sun-scope .login-err{color:#FF9A8A}
.lb-back{display:block;margin:0 auto 8px;font-family:var(--cond);font-weight:600;font-size:13px;
  letter-spacing:1px;text-transform:uppercase;color:var(--sun-muted);padding:6px 10px}
.lb-back:active{color:var(--sun-text)}
/* Sunrise guided start (Onboard under .sun-scope) */
.sun-scope .onb-wrap{color:var(--sun-text)}
.sun-scope .screen-title{color:var(--sun-text)}
.sun-scope .muted,.sun-scope .section-label{color:var(--sun-muted)}
.onb-sub-lg{font-size:14px;line-height:1.6;margin:8px 0 0}
.onb-dots{display:flex;gap:7px;justify-content:center;margin:2px 0 20px}
.onb-dots i{width:7px;height:7px;border-radius:50%;background:var(--sun-line)}
.onb-dots i.on{background:var(--sun-brand)}
.sun-scope .fmt-chip{background:var(--sun-card);border-color:var(--sun-line);color:var(--sun-muted)}
.sun-scope .fmt-chip.active{border-color:var(--sun-brand);color:var(--sun-text);background:var(--sun-card)}
.sun-scope .fmt-chip.active svg{color:var(--sun-brand)}
.sun-scope .builder-row{background:var(--sun-card);border-color:var(--sun-line)}
.sun-scope .builder-row input{color:var(--sun-text)}
.sun-scope .btn{border-color:var(--sun-line);color:var(--sun-text)}
.sun-scope .btn-accent{border-color:transparent;color:var(--sun-on-cta)}
.sun-scope .btn-go{border-color:transparent}
.sun-scope .theme-opt{background:var(--sun-card);border:1px solid var(--sun-line)}
.sun-scope .theme-opt.active{border-color:var(--sun-brand)}
.sun-scope .theme-opt .to-label{color:var(--sun-text)}
.sun-scope .voice-opt .to-label small{color:var(--sun-muted)}
.sun-scope .theme-opt .to-check{color:var(--sun-brand)}
.sun-scope .code-big{color:var(--sun-gold);background:var(--sun-card);
  border-color:color-mix(in srgb, var(--sun-gold) 45%, transparent)}
.sun-scope .field select{background:var(--sun-card);border-color:var(--sun-line);color:var(--sun-text)}
.auth-flip{display:block;width:100%;text-align:center;color:var(--muted);font-size:13px;margin-top:14px;text-decoration:underline;text-underline-offset:3px}

/* Talk-to-build onboarding (voice-first) */
.oc-mic-row{display:flex;flex-direction:column;align-items:center;gap:9px;margin:20px 0 4px}
.oc-mic{width:88px;height:88px;border-radius:50%;border:none;display:grid;place-items:center;color:#fff;
  background:linear-gradient(180deg,#FF9A6A,#FF6B4A);box-shadow:0 12px 34px -8px rgba(255,107,74,.6);cursor:pointer}
.oc-mic.rec{background:linear-gradient(180deg,#FF5A4A,#E23B2B);animation:ocpulse 1.5s ease-in-out infinite}
.oc-mic:disabled{opacity:.55;cursor:default}
@keyframes ocpulse{0%,100%{box-shadow:0 0 0 0 rgba(226,59,43,.5)}50%{box-shadow:0 0 0 16px rgba(226,59,43,0)}}
.oc-mic-hint{font-size:12.5px;color:var(--sun-muted)}
.oc-hint-busy{animation:pulse 1.4s ease-in-out infinite}
/* Breathing sunrise aura behind the mic while recording/transcribing. First
   child of the ramble step so it paints behind the content but over .sun-bg. */
.oc-aura{position:fixed;inset:0;pointer-events:none;animation:aura-in .6s ease-out}
.oc-aura i{position:absolute;left:50%;top:36%;width:min(150vw,680px);aspect-ratio:1;
  transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle, color-mix(in srgb,var(--sun-brand) 24%,transparent) 0%, transparent 62%);
  animation:aura-breathe 3.4s ease-in-out infinite}
.oc-aura i:nth-child(2){width:min(115vw,520px);animation-delay:-1.7s;
  background:radial-gradient(circle, color-mix(in srgb,var(--sun-amber) 18%,transparent) 0%, transparent 60%)}
.oc-aura.thinking i{animation-duration:1.7s}
/* While the mic is live the glow is driven by --lvl (real input level from an
   AnalyserNode), not a timer, so it visibly answers her voice. Falls back to
   the breathing keyframe if the meter never starts (--lvl stays 0). */
.oc-aura.live i{animation:none;
  transform:translate(-50%,-50%) scale(calc(.84 + var(--lvl,.06) * .6));
  opacity:calc(.5 + var(--lvl,.06) * .5);
  transition:transform .1s ease-out,opacity .1s ease-out}
@keyframes aura-in{from{opacity:0}to{opacity:1}}
@keyframes aura-breathe{0%,100%{transform:translate(-50%,-50%) scale(.88);opacity:.55}
  50%{transform:translate(-50%,-50%) scale(1.14);opacity:1}}
@media (prefers-reduced-motion: reduce){.oc-aura i{animation:none;opacity:.7}.oc-hint-busy{animation:none}
  .oc-aura.live i{transform:translate(-50%,-50%) scale(1);opacity:.7;transition:none}}
.oc-timer{font-family:var(--cond);font-weight:600;font-size:16px;letter-spacing:1px;color:var(--sun-text)}
.oc-cancel{background:none;border:none;color:var(--sun-muted);font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.oc-back-chat{display:inline-flex;align-items:center;gap:5px;background:none;border:none;padding:0 0 10px;
  color:var(--lpc-mut);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.sun-scope .oc-back-chat{color:var(--sun-muted)}
.fmt-chip small{display:block;width:100%;margin-top:3px;font-size:11px;line-height:1.35;opacity:.72;
  font-weight:400;letter-spacing:0;text-transform:none}
/* Onboarding chat step: fills the screen, one scroller, composer pinned. */
.onb-wrap.oc-chat{display:flex;flex-direction:column;min-height:0;overflow:hidden;
  padding-bottom:calc(10px + env(safe-area-inset-bottom))}
.onb-wrap.oc-chat .oc-msgs{flex:1;max-height:none;min-height:0;margin:6px 0 10px}
.onb-wrap.oc-chat .oc-chatbar,.onb-wrap.oc-chat .auth-flip{flex:none}
.oc-mic-sm{flex:none;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;
  border:1px solid var(--lpc-line);background:var(--lpc-card);color:var(--lpc-mut);cursor:pointer}
.oc-mic-sm:disabled{opacity:.45}
.oc-mic-sm.rec{background:var(--lpc-red);border-color:var(--lpc-red);color:#fff;
  animation:mic-pulse 1.1s ease-in-out infinite}
.oc-rec-line{font-size:12px;color:var(--lpc-mut);text-align:center;margin:8px 0 0}
.sun-scope .oc-mic-sm{border-color:var(--sun-line);background:var(--sun-card);color:var(--sun-muted)}
.sun-scope .oc-rec-line{color:var(--sun-muted)}
.oc-chatbar{display:flex;gap:8px;align-items:flex-end}
.oc-chatbar textarea{flex:1;background:var(--sun-card);border:1px solid var(--sun-line);border-radius:14px;
  padding:12px 14px;color:var(--sun-text);font:inherit;font-size:15px;line-height:1.4;resize:none}
.oc-chatbar textarea:focus{outline:none;border-color:var(--sun-brand)}
.oc-chatbar textarea::placeholder{color:var(--sun-muted)}
.oc-send{flex:none;width:46px;height:46px;padding:0;border-radius:50%;display:grid;place-items:center}
.oc-msgs{display:flex;flex-direction:column;gap:10px;margin:6px 0 12px;max-height:52vh;overflow-y:auto;overscroll-behavior:contain}
.sun-scope .cm{max-width:88%;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap}
.sun-scope .cm.ai{align-self:flex-start;background:var(--sun-card);border:1px solid var(--sun-line);border-bottom-left-radius:6px;color:var(--sun-text)}
.sun-scope .cm.user{align-self:flex-end;background:color-mix(in srgb,var(--sun-brand) 15%,transparent);
  border:1px solid color-mix(in srgb,var(--sun-brand) 32%,transparent);border-bottom-right-radius:6px;color:var(--sun-text)}
.sun-scope .cm.thinking{color:var(--sun-muted);font-style:italic;animation:pulse 1.2s ease-in-out infinite}
/* ── voice flow in the cream Linen world (the whole talk-to-build journey) ──
   The mic is the one warm focal point, in clay (Linen's own accent) rather
   than the off-brand sunrise coral. */
.lin .oc-mic{background:linear-gradient(180deg,#C68A6C,#A9503C);box-shadow:0 14px 40px -10px rgba(169,80,60,.5)}
.lin .oc-mic.rec{background:linear-gradient(180deg,#B85C48,#8E3B2B);animation-name:ocpulse-lin}
@keyframes ocpulse-lin{0%,100%{box-shadow:0 0 0 0 rgba(142,59,43,.4)}50%{box-shadow:0 0 0 16px rgba(142,59,43,0)}}
.lin .oc-mic-hint,.lin .oc-cancel{color:var(--lpc-mut)}
.lin .oc-timer{color:var(--lpc-ink)}
.lin .oc-aura i{background:radial-gradient(circle, color-mix(in srgb,#A9503C 15%,transparent) 0%, transparent 62%)}
.lin .oc-aura i:nth-child(2){background:radial-gradient(circle, color-mix(in srgb,#C68A6C 13%,transparent) 0%, transparent 60%)}
.lin .oc-chatbar textarea{background:var(--lpc-card);border-color:var(--lpc-line);color:var(--lpc-ink)}
.lin .oc-chatbar textarea:focus{border-color:var(--lpc-sage)}
.lin .oc-chatbar textarea::placeholder{color:#94988A}
.lin .cm{max-width:88%;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap}
.lin .cm.ai{align-self:flex-start;background:var(--lpc-card);border:1px solid var(--lpc-line);border-bottom-left-radius:6px;color:var(--lpc-ink)}
.lin .cm.user{align-self:flex-end;background:color-mix(in srgb,var(--lpc-sage) 16%,transparent);
  border:1px solid color-mix(in srgb,var(--lpc-sage) 34%,transparent);border-bottom-right-radius:6px;color:var(--lpc-ink)}
.lin .cm.thinking{color:var(--lpc-mut);font-style:italic;animation:pulse 1.2s ease-in-out infinite}
.oc-daybox{display:flex;gap:10px}
.oc-daybox .field{flex:1}
.oc-stepper{display:flex;align-items:center;justify-content:space-between;gap:4px;
  background:var(--sun-card);border:1px solid var(--sun-line);border-radius:13px;padding:5px}
.oc-stepper button{width:40px;height:38px;display:grid;place-items:center;border:none;border-radius:9px;
  background:transparent;color:var(--sun-muted);cursor:pointer}
.oc-stepper button:active{background:color-mix(in srgb,var(--sun-brand) 14%,transparent);color:var(--sun-text)}
.oc-step-n{font-family:var(--cond);font-weight:600;font-size:15px;letter-spacing:.5px;color:var(--sun-text);white-space:nowrap}

.onb-wrap{max-width:600px;margin:0 auto;min-height:100vh;
  padding:calc(26px + env(safe-area-inset-top)) 18px calc(60px + env(safe-area-inset-bottom))}
.onb-choice{display:grid;gap:12px;margin-top:18px}
.onb-choice .card{cursor:pointer;transition:border-color .15s}
.onb-choice .card:hover{border-color:var(--line-2)}
.onb-title{font-family:var(--cond);font-weight:700;font-size:19px;letter-spacing:.5px;display:flex;align-items:center;gap:10px}
.onb-sub{color:var(--muted);font-size:13px;margin-top:4px;line-height:1.45}
/* One per row: these carry a line of explanation now, and "Versus" next to
   "Partners" in a cramped two-up told a new user nothing. */
.fmt-picker{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:2px}
.fmt-chip{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 14px;border-radius:12px;
  background:var(--panel);border:1px solid var(--line);color:var(--muted);font-family:var(--cond);
  font-weight:600;font-size:14px;letter-spacing:.5px;text-align:left}
.fmt-chip.active{border-color:var(--brand);color:var(--text);background:var(--panel-2)}
.fmt-chip.active svg{color:var(--brand)}
.builder-row{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);
  border-radius:13px;padding:9px 10px;margin-bottom:8px}
.builder-row input,.builder-row textarea{background:transparent;border:none;color:var(--text);font-size:14px;min-width:0;font-family:inherit}
.builder-row input:focus,.builder-row textarea:focus{outline:none}
.builder-row textarea{resize:none;overflow:hidden;line-height:1.35;width:100%;display:block;padding:0}
.builder-row .br-label{flex:1.2;font-weight:600}
.builder-row .br-hint{flex:1;color:var(--muted);font-size:12px}
.kind-toggle{flex:none;font-family:var(--cond);font-size:10px;letter-spacing:1px;text-transform:uppercase;
  padding:5px 9px;border-radius:8px;border:1px solid var(--line-2);color:var(--muted)}
.kind-toggle.photo{color:var(--blue);border-color:color-mix(in srgb,var(--blue) 50%,transparent);background:color-mix(in srgb,var(--blue) 8%,transparent)}
.kind-toggle.check{color:var(--purple);border-color:color-mix(in srgb,var(--purple) 50%,transparent);background:color-mix(in srgb,var(--purple) 8%,transparent)}
.br-del{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--muted-2)}
.br-del:hover{color:var(--red)}
/* Cadence editor: a builder row that also carries a daily/weekly choice stacks
   its controls (.br-main) above a cadence sub-row (.br-cadence). */
.builder-row.br-multi{flex-direction:column;align-items:stretch;gap:8px}
.br-main{display:flex;align-items:center;gap:8px;justify-content:space-between}
/* Photo/Check as a visible either-or (Mayssa couldn't tell the old single
   badge was tappable) — same segmented language as the cadence pills. */
.kind-seg{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
.kind-seg button{font-family:var(--cond);font-size:10px;letter-spacing:.6px;text-transform:uppercase;
  padding:6px 10px;color:var(--muted);background:transparent;border:none;cursor:pointer}
.kind-seg button+button{border-left:1px solid var(--line-2)}
.kind-seg button.on{background:color-mix(in srgb,var(--brand) 14%,transparent);color:var(--brand)}
.lin .kind-seg,.lin .kind-seg button+button{border-color:var(--lpc-line)}
.lin .kind-seg button{color:var(--lpc-mut)}
.lin .kind-seg button.on{background:color-mix(in srgb,var(--lpc-gold) 16%,transparent);color:var(--lpc-gold)}
/* Day count is typeable (tap the number), ± still nudge. High-specificity +
   unsets so the global field/input pill styling can't repaint it. */
.oc-stepper input.oc-step-in,.lin .oc-stepper input.oc-step-in,.field .oc-stepper input.oc-step-in{
  width:46px;background:transparent;border:none;border-radius:0;box-shadow:none;color:inherit;
  font:inherit;text-align:center;padding:0;margin:0;height:auto;
  border-bottom:1px dashed color-mix(in srgb,currentColor 35%,transparent);-moz-appearance:textfield;appearance:textfield}
.oc-stepper input.oc-step-in:focus{outline:none;border-bottom-style:solid}
.oc-step-in::-webkit-outer-spin-button,.oc-step-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
/* Partial progress number inside a multi-a-day check square ("1" of 2) */
.wt-box .wt-count{font-family:var(--cond);font-weight:700;font-size:13px;color:var(--blue)}
/* Label + hint stack full-width so long titles wrap instead of clipping. */
.br-fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:5px}
.br-main .br-label{font-weight:600}
.br-main .br-hint{color:var(--muted);font-size:12px}
.br-cadence{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-left:2px}
.freq-toggle{display:inline-flex;border:1px solid var(--line-2);border-radius:9px;overflow:hidden}
.freq-toggle button{font-family:var(--cond);font-size:11px;letter-spacing:.4px;padding:6px 11px;
  color:var(--muted);background:transparent;border:none;cursor:pointer}
.freq-toggle button+button{border-left:1px solid var(--line-2)}
.freq-toggle button.on{background:color-mix(in srgb,var(--brand) 14%,transparent);color:var(--brand)}
.freq-times{display:inline-flex;align-items:center;gap:8px}
.freq-times button{width:30px;height:30px;display:grid;place-items:center;border:1px solid var(--line-2);
  border-radius:8px;color:var(--muted);background:transparent;cursor:pointer}
.freq-times button:active{color:var(--text)}
.freq-times span{font-family:var(--cond);font-size:12px;color:var(--text);min-width:74px;text-align:center}
.lin .freq-toggle,.lin .freq-times button{border-color:var(--lpc-line)}
.lin .freq-toggle button+button{border-color:var(--lpc-line)}
.lin .freq-toggle button{color:var(--lpc-mut)}
.lin .freq-toggle button.on{background:color-mix(in srgb,var(--lpc-gold) 16%,transparent);color:var(--lpc-gold)}
.lin .freq-times button{color:var(--lpc-mut)}
.lin .freq-times span{color:var(--lpc-ink)}
/* Opt-in body-goal card in the voice-onboarding review (cream Linen scope). */
.oc-plan{margin-top:16px;border:1px solid var(--lpc-line);border-radius:16px;padding:14px;background:var(--lpc-card)}
.oc-plan-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.oc-plan-toggle{font-family:var(--cond);font-size:11px;letter-spacing:.5px;text-transform:uppercase;
  padding:5px 12px;border-radius:99px;border:1px solid var(--lpc-line);color:var(--lpc-mut);background:transparent;cursor:pointer}
.oc-plan-toggle.on{background:color-mix(in srgb,var(--lpc-sage) 22%,transparent);color:var(--lpc-ink);
  border-color:color-mix(in srgb,var(--lpc-sage) 55%,transparent)}
.oc-plan-goal{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:17px;color:var(--lpc-ink);margin:2px 0 10px}
.lin .oc-plan .pp-grid{color:var(--lpc-mut)}
.lin .oc-plan .pp-grid b{color:var(--lpc-ink)}
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
.danger-opt .to-label{color:var(--red)}
/* Settings sheet: compact iconed section labels + action rows (Miska: fewer
   words, more visual). set-action rows lead with an icon, no sub-copy. */
.set-label{display:flex;align-items:center;gap:7px;font-family:var(--cond);font-weight:600;font-size:11px;
  letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin:20px 4px 9px}
.set-label svg{color:var(--muted-2);flex:none}
.set-action{gap:11px}
.set-action .to-label{flex:1;text-transform:none;letter-spacing:.2px;font-size:15px}
.set-action > svg:first-child{flex:none;color:var(--brand)}
.set-action .set-chev{color:var(--muted-2)}
.danger-opt.set-action > svg:first-child{color:var(--red)}
/* Add-item row (edit checklist): three even, wrapping buttons */
.add-row{display:flex;gap:8px;margin-top:6px}
.add-row .btn{flex:1;justify-content:center}
/* Dictation box: textarea with a mic tucked in the corner */
.guide-box{position:relative}
.guide-box textarea{width:100%;padding-right:46px}
.mic-btn{position:absolute;right:8px;bottom:8px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;
  border:1px solid var(--line-2);background:var(--panel);color:var(--muted);cursor:pointer}
.mic-btn.rec{background:var(--red);border-color:var(--red);color:#fff;animation:mic-pulse 1.1s ease-in-out infinite}
.lin .mic-btn{background:var(--lpc-card);border-color:var(--lpc-line);color:var(--lpc-mut)}
.lin .mic-btn.rec{background:var(--lpc-red);border-color:var(--lpc-red);color:#fff}
@keyframes mic-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--red) 45%,transparent)}50%{box-shadow:0 0 0 6px transparent}}
.danger-opt svg{color:var(--red);opacity:.8}
.danger-confirm{background:color-mix(in srgb,var(--red) 7%,transparent);border:1px solid color-mix(in srgb,var(--red) 28%,transparent);border-radius:14px;padding:14px}
.theme-swatch{width:36px;height:36px;border-radius:11px;border:1px solid var(--line-2);flex:none;
  display:flex;gap:4px;align-items:center;justify-content:center}
.theme-swatch i{width:9px;height:9px;border-radius:50%;display:block}
/* Mode picker: two big experience cards (Linen / Navy, + legacy Midnight) */
.mode-card{padding:14px;align-items:center}
.mode-card .to-label small{display:block;font-family:var(--body,Inter,sans-serif);font-weight:400;font-size:12px;
  letter-spacing:0;text-transform:none;margin-top:3px;opacity:.75}
.mode-preview{width:58px;height:58px;border-radius:14px;border:1px solid var(--line-2);flex:none;
  display:flex;flex-wrap:wrap;align-content:center;justify-content:center;column-gap:4px;padding:6px}
.mode-preview .mp-aa{width:100%;text-align:center;font-size:20px;font-weight:600;line-height:1;margin-bottom:4px}
.mode-preview i{width:8px;height:8px;border-radius:50%;display:inline-block}

/* ── the two experiences (+ hidden legacy Midnight = bare :root) ── */
/* ── Ink: the dark expression of the same monochrome-editorial identity —
   warm near-black + paper + the shared terracotta spot. (theme key stays
   "navy" so no stored-state migration; only the look + label change.) ── */
:root[data-theme="navy"]{
  --bg:#14110D; --panel:#1E1A14; --panel-2:#26211A; --panel-3:#312A20;
  --line:rgba(239,231,216,.10); --line-2:rgba(239,231,216,.18);
  --text:#EFE7D8; --muted:#A99C88; --muted-2:#7B7160;
  --red:#E0714E; --green:#8FB073; --gold:#E0B25A; --amber:#D98A4A; --blue:#B29A7E; --purple:#B79E86;
  --brand:#D2794A; --on-accent:#171209; --ring:rgba(239,231,216,.12);
  --glow-1:#241D14; --glow-2:#1B1710; --glow-fade:rgba(20,17,13,0);
}

/* ── Paper: monochrome editorial — warm cream + near-black ink + one
   terracotta spot + serif. Echoes the B&W stippled logo. (theme key stays
   "linen" so no stored-state migration; only the look + label change.) ── */
:root[data-theme="linen"]{
  color-scheme:light;
  --bg:#F2ECDF; --panel:#FBF6EA; --panel-2:#ECE2D0; --panel-3:#E0D4BE;
  --line:rgba(42,32,20,.13); --line-2:rgba(42,32,20,.24);
  --text:#1E1810; --muted:#6E6151; --muted-2:#9A8C78;
  --red:#9A3B2B; --green:#5E7449; --gold:#B0862C; --amber:#C08236; --blue:#7C6C57; --purple:#8A7360;
  --brand:#C15A34;
  --on-accent:#FBF3EA; --on-green:#F5F4EC; --on-amber:#FFF6EC; --on-red:#FFF3EE;
  --ring:rgba(42,32,20,.16);
  --glow-1:#ECE0C9; --glow-2:#E9DEC6; --glow-fade:rgba(242,236,223,0);
  --gc-face1:#F0DBCC; --gc-face2:#E9C9B5; --gc-star:rgba(193,90,52,.9);
  --r:22px; --r-sm:14px;
  --title-font:'Playfair Display',Georgia,serif; --title-track:0; --title-case:none;
  --num-font:'Playfair Display',Georgia,serif;
  --daypill-bg:#F0DFCB; --score-bg:#ECE1CE; --water-bg:#E9DFCB;
  --macro-bg:#ECE1CE; --goalcard-bg:#F2DCCD; --row-me-bg:#EEE4D0;
}
/* iOS standalone: warm-ink seat for the white status text */
:root[data-theme="linen"] body::before{content:'';position:fixed;top:0;left:0;right:0;
  height:env(safe-area-inset-top);background:#2A2018;z-index:98;pointer-events:none}
/* Playfair metrics vs Anton condensed: size/weight compensation, linen only */
:root[data-theme="linen"] .screen-title{font-size:28px;font-weight:600}
:root[data-theme="linen"] .vs-day{font-size:52px;font-weight:600}
:root[data-theme="linen"] .today-hero .h-day{font-size:36px;font-weight:600}
:root[data-theme="linen"] .daypill-n{font-size:18px;font-weight:600}
:root[data-theme="linen"] .tc-count{font-size:22px;font-weight:600}
:root[data-theme="linen"] .bg-now .n{font-size:38px;font-weight:600}
:root[data-theme="linen"] .lb-days{font-size:17px;font-weight:600}
`
