import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../appContext.js'
import { isMealReq, mealStats } from '../config.js'
import { canEditDay, currentDayNumber, isLogComplete, logDone, logTotal, entrySatisfies, checkCount, weeklyProgress, monthlyProgress, mealProgress, dueLabel, loggedLate, minutesIntoDay, dueMinutes, MIN_NOTE, SAVE_WINDOW_DAYS } from '../lib/challenge.js'
import { IS_MOBILE } from '../lib/device.js'
import { tapHaptic } from '../lib/native.js'
import * as api from '../data.js'
import Icon from './Icons.jsx'
import ProofImage from './ProofImage.jsx'
import Sheet from './Sheet.jsx'
import DayComplete from './DayComplete.jsx'
import Lightbox from './Lightbox.jsx'

export default function Today() {
  const { cfg, me, logs, reqsFor, actions, challenge, daysFor, myPlan, myTargets, t, mode, summaries, myMember } = useApp()
  const myDays = daysFor(me.id)
  const [uploading, setUploading] = useState(null)
  const [saving, setSaving] = useState(null) // requirement id of an in-flight check
  const [saveErr, setSaveErr] = useState(null)
  const [captioning, setCaptioning] = useState(null) // { req, entry } meal being described
  const [more, setMore] = useState(false) // macro bar: show the secondary numbers

  const reqs = reqsFor(me.id)
  const dayNum = currentDayNumber(cfg.startStr, cfg.todayStr)
  const myLogs = logs.filter((l) => l.userId === me.id)
  const log = myLogs.find((l) => l.logDate === cfg.todayStr) || null
  const approved = log?.status === 'approved'
  const rejected = log?.status === 'rejected'
  const editable = canEditDay(cfg.todayStr, cfg) && !approved

  const doneCount = logDone(reqs, log)
  const total = logTotal(reqs)
  const complete = isLogComplete(reqs, log)

  // Day Complete celebration: fires only on the false→true transition of
  // `complete` in THIS session (never on mount, so finishing on another device
  // doesn't re-celebrate here) and once per day via localStorage.
  const [celebrate, setCelebrate] = useState(false)
  const wasComplete = useRef(complete)
  useEffect(() => {
    if (complete && !wasComplete.current && dayNum >= 1 && dayNum <= myDays) {
      const key = `75hard-dc-${challenge.id}-${cfg.todayStr}`
      try {
        if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); setCelebrate(true) }
      } catch { setCelebrate(true) } // private mode: fall back to once per mount
    }
    wasComplete.current = complete
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete])

  // Self-heal: a meal with a caption and a photo but no estimate got stranded,
  // because the estimate is fired and forgotten and the phone that fired it may
  // have been locked, backgrounded, or off wifi before it came back.
  //
  // This used to give each entry exactly one retry per session and mark it
  // spent BEFORE the attempt, so a single bad moment stranded a meal until the
  // app was killed and reopened. Now it counts real failures, and it tries
  // again when the app comes back to the foreground, which is exactly when the
  // network usually returned.
  const tries = useRef(new Map())
  const healing = useRef(false)
  const [awake, setAwake] = useState(0)
  useEffect(() => {
    const wake = () => { if (document.visibilityState === 'visible') setAwake((n) => n + 1) }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [])

  useEffect(() => {
    if (!log || healing.current) return
    const stranded = reqs.filter(isMealReq).map((r) => log.entriesByReq?.[r.id]).filter(
      (e) => e && (e.photoPaths?.length || e.photoPath) && e.caption && e.estProtein == null
        && (tries.current.get(e.id) || 0) < 4
    )
    if (!stranded.length) return
    healing.current = true
    Promise.allSettled(stranded.map((e) => actions.estimateMeal(e.id)))
      .then((rs) => {
        // Only a failure burns an attempt. A success needs no bookkeeping and
        // a request still in flight was never counted in the first place.
        rs.forEach((r, i) => {
          if (r.status === 'rejected') {
            const id = stranded[i].id
            tries.current.set(id, (tries.current.get(id) || 0) + 1)
          }
        })
        return actions.refresh()
      })
      .catch(() => {})
      .finally(() => { healing.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, awake])

  async function onPick(req, file) {
    if (!file) return
    setUploading(req.id)
    setSaveErr(null)
    try {
      await actions.uploadProof(challenge.id, me.id, cfg.todayStr, req, file, log?.entriesByReq?.[req.id])
      await actions.refresh()
    } catch {
      setSaveErr(`"${req.label}" photo didn't save. Check your connection and try again.`)
    } finally {
      setUploading(null)
    }
  }

  async function onClearPhotos(req) {
    setSaveErr(null)
    try {
      await actions.clearPhotos(challenge.id, me.id, cfg.todayStr, req)
      await actions.refresh()
    } catch {
      setSaveErr(`Couldn't clear "${req.label}". Check your connection and try again.`)
    }
  }

  // A finished countdown marks its item done (never toggles off).
  async function completeTimer(req) {
    if (!editable || saving) return
    setSaving(req.id)
    setSaveErr(null)
    try {
      await actions.setChecked(challenge.id, me.id, cfg.todayStr, req, true)
      tapHaptic()
      await actions.refresh()
    } catch {
      setSaveErr(`"${req.label}" didn't save. Check your connection and tap it again.`)
    } finally {
      setSaving(null)
    }
  }

  async function toggleCheck(req) {
    if (!editable || saving) return
    const entry = log?.entriesByReq?.[req.id]
    const target = req.timesPerDay || 1
    setSaving(req.id)
    setSaveErr(null)
    try {
      if (target > 1) {
        // Multi-a-day item: each tap logs one more; a tap at the target clears
        // the day (same rhythm as toggling a plain check off).
        const cur = checkCount(entry)
        const next = cur >= target ? 0 : cur + 1
        await actions.setCheckCount(challenge.id, me.id, cfg.todayStr, req, next)
      } else {
        const cur = entrySatisfies(req, entry)
        await actions.setChecked(challenge.id, me.id, cfg.todayStr, req, !cur)
      }
      tapHaptic()
      await actions.refresh()
    } catch {
      setSaveErr(`"${req.label}" didn't save. Check your connection and tap it again.`)
    } finally {
      setSaving(null)
    }
  }

  // Your last answer for this item, so a note is written against your own
  // record rather than into a void.
  function prevNote(reqId) {
    for (const l of myLogs.filter((x) => x.logDate < cfg.todayStr).sort((a, b) => b.logDate.localeCompare(a.logDate))) {
      const e = l.entriesByReq?.[reqId]
      if (e?.caption) return { date: l.logDate, text: e.caption }
    }
    return null
  }

  async function saveNoteFor(req, text) {
    setSaveErr(null)
    try {
      await actions.saveNote(challenge.id, me.id, cfg.todayStr, req, text)
      tapHaptic()
      await actions.refresh()
    } catch { setSaveErr(`"${req.label}" didn't save. Try again.`) }
  }

  async function dismissFlag(entry) {
    await actions.dismissAiFlag(entry.id)
    await actions.refresh()
  }

  if (dayNum < 1) {
    // The countdown used to sit in the header, crowded between the challenge
    // name and the avatar. It belongs here, where the waiting is the subject.
    // And a date reads as a date: "August 14", not 2026-08-14 (Miska).
    const away = 1 - dayNum
    const startsPretty = new Date(cfg.startStr + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    // Local lists. The shared ones are declared further down this component,
    // and reaching forward from an early return is a temporal dead zone: the
    // same mistake that blanked the app an hour ago, in a branch only someone
    // with a future start date ever reaches, which is why it got past me.
    const isDay = (r) => r.frequency !== 'weekly' && r.frequency !== 'monthly'
    const peekPhotos = reqs.filter((r) => r.kind === 'photo' && isDay(r) && !api.isExtraMeal(r))
    const peekChecks = reqs.filter((r) => r.kind === 'check' && isDay(r))
    // Same grouping the live screen uses. Without this, someone previewing
    // day one sees a flat list and reasonably concludes grouping did nothing.
    const peekGroupOf = (r) => (r.group && r.group !== 'Fuel' ? r.group : null)
    const peekGroups = [...new Set(peekChecks.map(peekGroupOf).filter(Boolean))]
      .filter((g) => peekChecks.filter((r) => peekGroupOf(r) === g).length > 1)
    const peekLoose = peekChecks.filter((r) => !peekGroups.includes(peekGroupOf(r)))
    const peekNotes = reqs.filter((r) => r.kind === 'note' && isDay(r))
    const peekCadence = reqs.filter((r) => (r.frequency === 'weekly' || r.frequency === 'monthly') && !api.isExtraMeal(r))
    return (
      <div className="notyet">
        <div className="e-ic"><Icon name="clock" size={40} /></div>
        <div className="ny-count">{away === 1 ? 'Starts tomorrow' : `Starts in ${away} days`}</div>
        <div className="screen-title" style={{ fontSize: 22, marginTop: 2 }}>Not started yet</div>
        <p className="muted">{t('today.notstarted.sub', { name: challenge.name, start: startsPretty })}</p>

        {/* A look at day one while you wait. Curiosity is the point: nobody
            gets more excited about a challenge they cannot see yet. */}
        <div className="ny-peek">
          <div className="section-label">{t('today.notstarted.peek')}</div>
          <div className="slots-grid">
            {peekPhotos.slice(0, 4).map((r) => (
              <div key={r.id} className="slot preview">
                <span className="slot-ic"><Icon name={r.icon || 'camera'} size={22} /></span>
                <span className="slot-label">{r.label}</span>
                <span className="slot-hint">{r.hint || 'Photo proof'}</span>
              </div>
            ))}
          </div>
          {peekGroups.map((g) => {
            const items = peekChecks.filter((r) => peekGroupOf(r) === g)
            return (
              <div key={g} className="grp">
                <div className="grp-head">
                  <span className="grp-name">{g}</span>
                  <span className="grp-count">0 of {items.length}</span>
                </div>
                <div className="grp-items">
                  {items.map((r) => (
                    <span key={r.id} className="grp-chip"><span className="gc-box" />{r.label}</span>
                  ))}
                </div>
              </div>
            )
          })}
          {peekLoose.map((r) => (
            <div key={r.id} className="watertoggle preview" style={{ marginBottom: 8 }}>
              <span className="wt-box" />
              <span style={{ flex: 1 }}>
                <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
                {r.hint && <span className="wt-hint">{r.hint}</span>}
              </span>
              <Icon name={r.icon || 'bolt'} size={22} style={{ color: 'var(--muted-2)' }} />
            </div>
          ))}
          {peekCadence.length > 0 && (
            <>
              {/* Mirrors the live section: photo items look like photo items,
                  the count sits on each one, and the "shows every day" rule is
                  said once at the top instead of on every row (Miska). */}
              <div className="section-label" style={{ marginTop: 18 }}>Weekly goals</div>
              <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                These show every day until you have completed them.
              </p>
              <div className="slots-grid">
                {peekCadence.filter((r) => r.kind === 'photo').map((r) => (
                  <div key={r.id} className="slot preview">
                    <span className="slot-ic"><Icon name={r.icon || 'camera'} size={22} /></span>
                    <span className="slot-label">{r.label}</span>
                    <span className="slot-hint">0 of {r.timesPerWeek || r.timesPerMonth || 1} this {r.frequency === 'monthly' ? 'month' : 'week'}</span>
                  </div>
                ))}
              </div>
              {peekCadence.filter((r) => r.kind === 'note').map((r) => (
                <div key={r.id} className="noteline preview">
                  <div className="nl-head">
                    <span className="nl-box"><Icon name="edit" size={13} /></span>
                    <span className="nl-title">{r.label}</span>
                  </div>
                  {r.hint && <div className="nl-q">{r.hint}</div>}
                  <div className="nl-row"><span className="nl-in fr-input nl-ghost">Type your answer here</span></div>
                </div>
              ))}
              {peekCadence.filter((r) => r.kind !== 'photo' && r.kind !== 'note').map((r) => (
                <div key={r.id} className="watertoggle preview" style={{ marginBottom: 8 }}>
                  <span className="wt-box wt-count-box">0/{r.timesPerWeek || r.timesPerMonth || 1}</span>
                  <span style={{ flex: 1 }}>
                    <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
                    <span className="wt-hint">{r.hint || `${r.timesPerWeek || r.timesPerMonth || 1}× a ${r.frequency === 'monthly' ? 'month' : 'week'}`}</span>
                  </span>
                  <Icon name={r.icon || 'bolt'} size={22} style={{ color: 'var(--muted-2)' }} />
                </div>
              ))}
            </>
          )}
          {peekNotes.map((r) => (
            <div key={r.id} className="noteline preview">
              <div className="nl-head">
                <span className="nl-box"><Icon name="edit" size={13} /></span>
                <span className="nl-title">{r.label}</span>
              </div>
              {r.hint && <div className="nl-q">{r.hint}</div>}
              <div className="nl-row"><span className="nl-in fr-input nl-ghost">Type your answer here</span></div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (dayNum > myDays) {
    return (
      <div className="empty">
        <div className="e-ic"><Icon name="trophy" size={40} /></div>
        <div className="screen-title" style={{ fontSize: 22 }}>{t('today.finished.title', { n: myDays })}</div>
        <p>{t('today.finished.sub')}</p>
      </div>
    )
  }

  // One flush grid — no group sections; every tile carries its own title.
  // Extra-meal slots only render once filled; the empty next one is offered
  // via the "+ Add a meal" tile (body-goal users only).
  const isFilled = (r) => { const e = log?.entriesByReq?.[r.id]; return !!(e?.photoPaths?.length || e?.photoPath) }
  const daily = (r) => r.frequency !== 'weekly' && r.frequency !== 'monthly'
  // Meals pool (see challenge.js): once you've logged as many meal photos as
  // the day asks for, a leftover empty "Meal 2" box is just anxiety — the meal
  // duty is already done, in whatever order the food actually happened. Drop
  // the unfilled numbered slots then, the way filled-only extras already work.
  // A save nobody can find may as well not exist (Dylen went looking and
  // concluded it wasn't there). Surface the most recent still-saveable day
  // right where people actually look, and say nothing when there isn't one.
  const myS = summaries[me.id]
  let saveDay = null
  if (myMember && !myMember.redemptionDate && myS) {
    for (let n = dayNum - 1; n >= Math.max(1, dayNum - SAVE_WINDOW_DAYS); n--) {
      if (myS.states[n] === 'fail') { saveDay = n; break }
    }
  }
  const mealPool = mealProgress(reqs, log)
  const mealSlotDone = (r) => mealPool.met && isMealReq(r) && !r.optional && !isFilled(r)
  const photos = reqs.filter((r) => r.kind === 'photo' && daily(r)
    && (!api.isExtraMeal(r) || isFilled(r)) && !mealSlotDone(r))
  const allChecks = reqs.filter((r) => r.kind === 'check' && daily(r))
  // Items sharing a group name become one tile. "Fuel" is the meal tag the
  // coach writes, not a group someone chose, so it never collapses.
  const groupOf = (r) => (r.group && r.group !== 'Fuel' ? r.group : null)
  const groupNames = [...new Set(allChecks.map(groupOf).filter(Boolean))]
    .filter((g) => allChecks.filter((r) => groupOf(r) === g).length > 1)
  const checks = allChecks.filter((r) => !groupNames.includes(groupOf(r)))
  const notes = reqs.filter((r) => r.kind === 'note' && daily(r))
  const timers = reqs.filter((r) => r.kind === 'timer' && daily(r))
  // Weekly-cadence items live in their own "This week" section — they never
  // gate the day, so they're pulled out of the daily grids above.
  const weekly = reqs.filter((r) => r.frequency === 'weekly' && !api.isExtraMeal(r)).sort((a, b) => a.sort - b.sort)
  const wprog = weeklyProgress(reqs, myLogs, { startStr: cfg.startStr, dayNumber: dayNum, totalDays: myDays })
  const monthly = reqs.filter((r) => r.frequency === 'monthly' && !api.isExtraMeal(r)).sort((a, b) => a.sort - b.sort)
  const mprog = monthlyProgress(reqs, myLogs, { startStr: cfg.startStr, dayNumber: dayNum, totalDays: myDays })
  const extraSlots = reqs.filter((r) => api.isExtraMeal(r) && r.kind === 'photo').sort((a, b) => a.sort - b.sort)
  const nextExtra = extraSlots.find((r) => !isFilled(r))
  // Body-goal extras (only for members with a plan): filled meal entries get
  // captions; estimates roll up into the macro bar.
  // Nutrition no longer requires a body plan. Anyone logging meals sees what
  // they ate; a plan only adds targets to compare against.
  const meals = photos.filter(isMealReq)
    .map((r) => ({ req: r, entry: log?.entriesByReq?.[r.id] }))
    .filter(({ entry }) => entry?.photoPaths?.length || entry?.photoPath)
  const tot = (k) => meals.reduce((a, { entry }) => a + (entry[k] || 0), 0)
  const estP = tot('estProtein')
  const estC = tot('estCalories')
  const macros = {
    protein: estP, calories: estC, fiber: tot('estFiber'), satFat: tot('estSatFat'),
    carbs: tot('estCarbs'), fat: tot('estFat'), sodium: tot('estSodium'), sugar: tot('estSugar'),
  }
  const hasMacros = meals.some(({ entry }) => entry.estCalories != null)
  const showNutrition = hasMacros && myTargets.nutritionMode !== 'off'
  const flagged = reqs
    .map((r) => ({ req: r, entry: log?.entriesByReq?.[r.id] }))
    .filter(({ entry }) => entry?.aiFlag && !entry.aiDismissed)

  return (
    <div>
      {mode === 'soft' ? (
        // Linen layout: the day IS the hero — big ring, serif day number, and
        // a voice line instead of the stat-dense header + togo banner.
        <>
          <SoftHero dayNum={dayNum} done={doneCount} total={total} date={cfg.todayStr} complete={complete} t={t} />
          {(approved || rejected || (complete && cfg.hasReferee)) && (
            <StatusBanner approved={approved} rejected={rejected} complete={complete} note={log?.judgeNote}
              doneCount={doneCount} total={total} hasReferee={cfg.hasReferee} t={t} />
          )}
        </>
      ) : (
        <>
          <div className="today-hero">
            <div>
              <div className="section-label" style={{ margin: '0 0 2px' }}>Today · {cfg.todayStr}</div>
              <div className="h-day">DAY {dayNum}</div>
            </div>
            <Ring done={doneCount} total={total} />
          </div>

          <StatusBanner approved={approved} rejected={rejected} complete={complete} note={log?.judgeNote}
            doneCount={doneCount} total={total} hasReferee={cfg.hasReferee} t={t} />
        </>
      )}

      {showNutrition && (
        <div className="macrobar">
          <MacroRow label="Protein" value={macros.protein} unit="g"
            target={myTargets.proteinMin} max={myTargets.proteinMax} />
          <MacroRow label="Calories" value={macros.calories} unit=""
            target={myTargets.calorieTarget} />
          <MacroRow label="Fiber" value={macros.fiber} unit="g"
            target={myTargets.fiberTarget} />
          {/* Saturated fat is the one where less is better, so it reads as a
              ceiling rather than something to fill up. */}
          <MacroRow label="Sat fat" value={macros.satFat} unit="g"
            target={myTargets.satFatMax} ceiling />
          {more && (
            <>
              <MacroRow label="Carbs" value={macros.carbs} unit="g" />
              <MacroRow label="Total fat" value={macros.fat} unit="g" />
              <MacroRow label="Sodium" value={macros.sodium} unit="mg" target={myTargets.sodiumMax} ceiling />
              <MacroRow label="Sugar" value={macros.sugar} unit="g" target={myTargets.sugarMax} ceiling />
            </>
          )}
          <button className="mb-more" onClick={() => setMore((v) => !v)}>
            {more ? 'Less' : 'More'}<Icon name="chevron" size={12} />
          </button>
          {/* The meal count lives here now that satisfied slots stop rendering,
              so "am I covered?" is answerable without counting tiles. */}
          <div className="mb-hint">
            {mealPool.target > 0 && (mealPool.met
              ? <>all {mealPool.target} meals logged · </>
              : <>{mealPool.logged} of {mealPool.target} meals · </>)}
            estimates from your photos + captions
          </div>
        </div>
      )}

      {saveDay && (
        <button className="save-nudge" onClick={() => actions.goTo('history')}>
          <Icon name="shield" size={16} />
          <span className="sn-txt">Day {saveDay} can still be saved</span>
          <Icon name="chevron" size={14} />
        </button>
      )}

      {saveErr && (
        <div className="ai-note" style={{ borderColor: 'color-mix(in srgb, var(--red) 45%, transparent)', background: 'color-mix(in srgb, var(--red) 8%, transparent)' }}>
          <span className="an-txt"><b>Not saved:</b> {saveErr}</span>
          <button className="btn btn-sm" onClick={() => setSaveErr(null)}>OK</button>
        </div>
      )}

      {flagged.map(({ req, entry }) => (
        <div className="ai-note" key={entry.id}>
          <span className="an-txt"><b>Spot check · {req.label}:</b> {entry.aiNote || t('today.aiflag.fallback')}</span>
          <button className="btn btn-sm" onClick={() => dismissFlag(entry)}>{t('today.aiflag.dismiss')}</button>
        </div>
      ))}

      {photos.some((r) => r.multi) && (
        <div className="section-label" style={{ marginBottom: 8 }}>
          <span className="new-badge" style={{ marginLeft: 0 }}>New: multi-photo upload on workouts</span>
        </div>
      )}
      <div className="slots-grid" style={{ marginTop: 12 }}>
        {photos.map((r) => (
          <PhotoSlot key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} editable={editable}
            uploading={uploading === r.id} onPick={(f) => onPick(r, f)} onClear={() => onClearPhotos(r)}
            mealMode={isMealReq(r)}
            onCaption={() => setCaptioning({ req: r, entry: log?.entriesByReq?.[r.id] })} cfg={cfg} />
        ))}
        {editable && nextExtra && (
          <AddMealSlot uploading={uploading === nextExtra.id} onPick={(f) => onPick(nextExtra, f)} captureOnly={nextExtra.captureOnly} />
        )}
      </div>

      {checks.length > 0 && <div style={{ height: 14 }} />}
      {groupNames.map((g) => {
        const items = allChecks.filter((r) => groupOf(r) === g)
        const done = items.filter((r) => entrySatisfies(r, log?.entriesByReq?.[r.id])).length
        return (
          <div key={g} className="grp">
            <div className="grp-head">
              <span className="grp-name">{g}</span>
              <span className={'grp-count' + (done === items.length ? ' met' : '')}>{done} of {items.length}</span>
            </div>
            <div className="grp-items">
              {items.map((r) => {
                const on = entrySatisfies(r, log?.entriesByReq?.[r.id])
                return (
                  <button key={r.id} className={'grp-chip' + (on ? ' on' : '')} disabled={!editable || saving === r.id}
                    onClick={() => toggleCheck(r)}>
                    <span className="gc-box">{on && <Icon name="check" size={11} strokeWidth={3} />}</span>
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {notes.map((r) => (
        <NoteLine key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} cfg={cfg} editable={editable}
          previous={prevNote(r.id)}
          onSave={(text) => saveNoteFor(r, text)} />
      ))}

      {checks.map((r) => {
        const entry = log?.entriesByReq?.[r.id]
        const on = entrySatisfies(r, entry)
        const target = r.timesPerDay || 1
        const count = checkCount(entry)
        const busy = saving === r.id
        return (
          <button key={r.id} className={'watertoggle' + (on ? ' on' : '')} onClick={() => toggleCheck(r)}
            disabled={!editable || busy} style={{ marginBottom: 8, opacity: busy ? 0.6 : undefined }}>
            <span className="wt-box" style={on ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}>
              {on ? <Icon name="check" size={18} /> : (target > 1 && count > 0 ? <span className="wt-count">{count}</span> : null)}
            </span>
            <span style={{ flex: 1 }}>
              <span className="wt-title" style={{ display: 'block' }}>
                {r.label}{' '}<DueBadge req={r} entry={entry} cfg={cfg} />
              </span>
              <span className="wt-hint">
                {busy ? 'Saving…'
                  : on ? `Saved ✓${r.hint ? ' · ' + r.hint : ''}`
                  : target > 1 ? `${count} of ${target} today — tap to log one${r.hint ? ' · ' + r.hint : ''}`
                  : (r.hint || '')}
              </span>
            </span>
            <Icon name={r.icon || 'bolt'} size={22} style={{ color: on ? 'var(--blue)' : 'var(--muted-2)' }} />
          </button>
        )
      })}

      {timers.length > 0 && <div style={{ height: 6 }} />}
      {timers.map((r) => (
        <TimerTile key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} editable={editable}
          busy={saving === r.id} todayStr={cfg.todayStr}
          onComplete={() => completeTimer(r)} onClear={() => toggleCheck(r)} />
      ))}

      {weekly.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>Weekly goals</div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            These show every day until you have completed them.
          </p>
          {/* Grouping works here too. Her two parent calls are weekly, and a
              group that only worked on daily items was a group that did not
              work (Miska). */}
          {/* Photo items group too: hers are two photo calls under "Family",
              and a group that only worked for checks was not a group. Photos
              keep their tiles, just gathered under one heading. */}
          {[...new Set(weekly.filter((r) => r.kind === 'photo' && groupOf(r)).map(groupOf))]
            .filter((g) => weekly.filter((r) => groupOf(r) === g).length > 1)
            .map((g) => {
              const items = weekly.filter((r) => groupOf(r) === g)
              const met = items.filter((r) => (wprog[r.id] || {}).met).length
              return (
                <div key={g} className="grp">
                  <div className="grp-head">
                    <span className="grp-name">{g}</span>
                    <span className={'grp-count' + (met === items.length ? ' met' : '')}>{met} of {items.length} done</span>
                  </div>
                  <div className="slots-grid">
                    {items.map((r) => {
                      const wp = wprog[r.id] || { done: 0, target: r.timesPerWeek || 1 }
                      return (
                        <PhotoSlot key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} editable={editable}
                          uploading={uploading === r.id} onPick={(f) => onPick(r, f)} onClear={() => onClearPhotos(r)}
                          cfg={cfg} badge={`${wp.done}/${wp.target}`} />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          {[...new Set(weekly.filter((r) => r.kind === 'check' && groupOf(r)).map(groupOf))]
            .filter((g) => weekly.filter((r) => groupOf(r) === g).length > 1)
            .map((g) => {
              const items = weekly.filter((r) => groupOf(r) === g)
              const met = items.filter((r) => (wprog[r.id] || {}).met).length
              return (
                <div key={g} className="grp">
                  <div className="grp-head">
                    <span className="grp-name">{g}</span>
                    <span className={'grp-count' + (met === items.length ? ' met' : '')}>{met} of {items.length} done</span>
                  </div>
                  <div className="grp-items">
                    {items.map((r) => {
                      const wp = wprog[r.id] || { done: 0, target: r.timesPerWeek || 1, met: false }
                      const onToday = entrySatisfies(r, log?.entriesByReq?.[r.id])
                      return (
                        <button key={r.id} className={'grp-chip' + (onToday ? ' on' : '') + (wp.met ? ' met' : '')}
                          disabled={!editable || saving === r.id} onClick={() => toggleCheck(r)}>
                          <span className="gc-box">{onToday && <Icon name="check" size={11} strokeWidth={3} />}</span>
                          {r.label} <small>{wp.done}/{wp.target}</small>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          {weekly.filter((r) => {
            const g = groupOf(r)
            return !(g && weekly.filter((x) => groupOf(x) === g).length > 1)
          }).map((r) => {
            const wp = wprog[r.id] || { done: 0, target: r.timesPerWeek || 1, met: false }
            const onToday = entrySatisfies(r, log?.entriesByReq?.[r.id])
            const badge = `${wp.done} of ${wp.target} this week`
            // A weekly note is still a note. It was rendering as a checkbox
            // row here, which is exactly the confusion the kind exists to
            // avoid (Miska).
            if (r.kind === 'note') {
              return (
                <NoteLine key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} cfg={cfg} editable={editable}
                  badge={badge} previous={prevNote(r.id)} onSave={(text) => saveNoteFor(r, text)} />
              )
            }
            if (r.kind !== 'photo') {
              const busy = saving === r.id
              return (
                <button key={r.id} className={'watertoggle wk' + (onToday ? ' on' : '') + (wp.met ? ' met' : '')}
                  onClick={() => toggleCheck(r)} disabled={!editable || busy} style={{ marginBottom: 8, opacity: busy ? 0.6 : undefined }}>
                  <span className="wt-box" style={onToday ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}>{onToday && <Icon name="check" size={18} />}</span>
                  <span style={{ flex: 1 }}>
                    <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
                    <span className="wt-hint" style={wp.met ? { color: 'var(--green)' } : undefined}>{busy ? 'Saving…' : `${badge}${onToday ? ' · logged today' : ''}`}</span>
                  </span>
                  <Icon name={r.icon || 'bolt'} size={22} style={{ color: wp.met ? 'var(--green)' : 'var(--muted-2)' }} />
                </button>
              )
            }
            return (
              <div key={r.id} className={'wk-photo' + (wp.met ? ' met' : '')}>
                <div className="wk-row">
                  <span className="wk-title">{r.label}</span>
                  <span className={'wk-badge' + (wp.met ? ' met' : '')}>{badge}</span>
                </div>
                <div className="slots-grid">
                  <PhotoSlot req={r} entry={log?.entriesByReq?.[r.id]} editable={editable}
                    uploading={uploading === r.id} onPick={(f) => onPick(r, f)} onClear={() => onClearPhotos(r)}
                    mealMode={!!myPlan && isMealReq(r)}
                    onCaption={() => setCaptioning({ req: r, entry: log?.entriesByReq?.[r.id] })} cfg={cfg} />
                </div>
              </div>
            )
          })}
        </>
      )}

      {monthly.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>This month</div>
          {monthly.map((r) => {
            const mp = mprog[r.id] || { done: 0, target: r.timesPerMonth || 1, met: false }
            const onToday = entrySatisfies(r, log?.entriesByReq?.[r.id])
            const badge = `${mp.done} of ${mp.target} this month`
            if (r.kind !== 'photo') {
              const busy = saving === r.id
              return (
                <button key={r.id} className={'watertoggle wk' + (onToday ? ' on' : '') + (mp.met ? ' met' : '')}
                  onClick={() => toggleCheck(r)} disabled={!editable || busy} style={{ marginBottom: 8, opacity: busy ? 0.6 : undefined }}>
                  <span className="wt-box" style={onToday ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}>{onToday && <Icon name="check" size={18} />}</span>
                  <span style={{ flex: 1 }}>
                    <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
                    <span className="wt-hint" style={mp.met ? { color: 'var(--green)' } : undefined}>{busy ? 'Saving…' : `${badge}${onToday ? ' · logged today' : ''}`}</span>
                  </span>
                  <Icon name={r.icon || 'bolt'} size={22} style={{ color: mp.met ? 'var(--green)' : 'var(--muted-2)' }} />
                </button>
              )
            }
            return (
              <div key={r.id} className={'wk-photo' + (mp.met ? ' met' : '')}>
                <div className="wk-row">
                  <span className="wk-title">{r.label}</span>
                  <span className={'wk-badge' + (mp.met ? ' met' : '')}>{badge}</span>
                </div>
                <div className="slots-grid">
                  <PhotoSlot req={r} entry={log?.entriesByReq?.[r.id]} editable={editable}
                    uploading={uploading === r.id} onPick={(f) => onPick(r, f)} onClear={() => onClearPhotos(r)}
                    mealMode={!!myPlan && isMealReq(r)}
                    onCaption={() => setCaptioning({ req: r, entry: log?.entriesByReq?.[r.id] })} cfg={cfg} />
                </div>
              </div>
            )
          })}
        </>
      )}

      {!editable && !approved && (
        <p className="center muted" style={{ fontSize: 12, marginTop: 16 }}>You can only log proof on the current day.</p>
      )}

      {celebrate && (
        <DayComplete dayNum={dayNum} streak={(summaries[me.id]?.streak ?? 0) + 1}
          name={challenge.name} onClose={() => setCelebrate(false)} />
      )}

      {captioning && (
        <CaptionSheet req={captioning.req} entry={captioning.entry}
          onSave={async (text) => {
            const { id: eid } = captioning.entry
            const label = captioning.req.label
            setCaptioning(null)
            try {
              // Save the new caption (clears the stale estimate), show
              // "estimating…", then re-score the meal and refresh the numbers.
              await actions.saveCaption(eid, text)
              healed.current.add(eid) // we own this re-estimate; block the self-heal effect from double-firing
              await actions.refresh()
              if (text.trim()) {
                await actions.estimateMeal(eid)
                await actions.refresh()
              }
            } catch {
              healed.current.delete(eid) // failed — let the self-heal net retry it later
              setSaveErr(`Couldn't update "${label}" — check your connection and try again.`)
            }
          }}
          onClose={() => setCaptioning(null)} />
      )}
    </div>
  )
}

// "by noon" on the tile, and an honest mark when it slipped. The app knows
// when proof was LOGGED, never when the walk happened, so a late mark is a
// record and not a failure: someone who walks at 11 and uploads at 1 did the
// thing, and calling that a miss would be the app lying about what it saw.
export function DueBadge({ req, entry, cfg }) {
  if (req?.dueBy == null) return null
  const late = loggedLate(req, entry, cfg.timezone, cfg.dayEndHour)
  const done = !!entry && (entry.photoPaths?.length || entry.photoPath || entry.checked || entry.checkCount > 0)
  const overdue = !done && minutesIntoDay(cfg.timezone, cfg.dayEndHour) > dueMinutes(req.dueBy, cfg.dayEndHour)
  return (
    <span className={'due-pill' + (late || overdue ? ' late' : '')}>
      <Icon name="clock" size={9} />
      {late ? `after ${dueLabel(req.dueBy)}` : overdue ? `was due ${dueLabel(req.dueBy)}` : `by ${dueLabel(req.dueBy)}`}
    </span>
  )
}

export function PhotoSlot({ req, entry, editable, uploading, onPick, onClear, mealMode, onCaption, cfg, badge }) {
  const paths = entry?.photoPaths?.length ? entry.photoPaths : (entry?.photoPath ? [entry.photoPath] : [])
  const filled = paths.length > 0
  const flagged = entry?.aiFlag && !entry.aiDismissed
  const canAddMore = editable && (!filled || (req.multi && paths.length < api.MAX_PHOTOS_PER_ITEM))
  const showCap = mealMode && filled // caption + macros live on the tile itself
  const inputRef = useRef(null)
  const [menu, setMenu] = useState(false)
  const [viewing, setViewing] = useState(false)

  // A filled tile has more than one reasonable meaning for a tap: look at it,
  // read what the app estimated, shoot it again, throw it out. It used to do
  // the last two by accident, so now it asks which one you meant.
  const canPick = editable && (canAddMore || !req.multi) && IS_MOBILE
  const useMenu = filled && editable && !uploading
  const hint = uploading ? 'Uploading…'
    : !filled ? (req.hint || 'Photo proof')
    : useMenu ? 'Tap for options'
    : req.multi ? (canAddMore ? 'Tap to add another' : 'Full set')
    : 'Tap to retake'
  return (
    <label className={'slot' + (filled ? ' filled' : '') + (uploading ? ' uploading' : '') + (!(editable && (canAddMore || !req.multi)) ? ' locked' : '')}
      onClick={(e) => {
        if (!useMenu) return
        // The menu and the viewer are portals, so their clicks land on <body>
        // but still bubble through the REACT tree to this label. Without this
        // guard, closing the viewer reopens the menu behind it.
        if (!e.currentTarget.contains(e.target)) return
        e.preventDefault() // or the wrapping label fires the file input
        setMenu(true)
      }}>
      {filled && <span className="slot-thumb"><ProofImage path={paths[paths.length - 1]} alt={req.label} /></span>}
      {!filled && <span className="slot-ic"><Icon name={req.icon || 'camera'} size={22} /></span>}
      {filled && !flagged && (
        <span className="slot-check">
          {req.multi && paths.length > 1
            ? <b style={{ fontSize: 11 }}>{paths.length}</b>
            : <Icon name="check" size={15} strokeWidth={2.4} />}
        </span>
      )}
      {flagged && <span className="ai-chip"><Icon name="bolt" size={11} />AI flag</span>}
      {req.multi && paths.length > 1 && <span className="slot-stack">{paths.length} photos</span>}
      {req.minMinutes && <span className="slot-min">{req.minMinutes} min</span>}
      {/* No corner x. Removal lives in the options menu now: a one-tap destroy
          button in the corner of a tile people tap to look at their own photo
          is how a logged meal got thrown away. */}
      <span className="slot-label">{req.label}</span>
      {cfg && <span className="slot-due">{badge ? <span className="due-pill">{badge}</span> : <DueBadge req={req} entry={entry} cfg={cfg} />}</span>}
      {showCap ? (
        <button className={'slot-cap' + (entry?.caption ? '' : ' empty')}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCaption() }}>
          {entry?.caption ? (
            <>
              <span className="sc-text">{entry.caption}<Icon name="edit" size={11} className="sc-edit" /></span>
              <span className="sc-est">{entry.estProtein != null ? `~${entry.estProtein}g protein · ${entry.estCalories ?? '?'} cal · tap to edit` : 'estimating…'}</span>
            </>
          ) : (
            <span className="sc-text">＋ what was it?</span>
          )}
        </button>
      ) : (
        <span className="slot-hint">{hint}</span>
      )}
      {/* Photo source honors the item's setting: capture-only forces the live
          camera (the keep-yourself-honest mode); otherwise iOS offers
          library/camera/files so screenshots (Oura, watch apps) work too.
          Value reset lets iOS re-fire the picker for the same file. */}
      {(editable && (canAddMore || !req.multi)) && IS_MOBILE && <input ref={inputRef} type="file" accept="image/*"
        capture={req.captureOnly ? 'environment' : undefined}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f) }} />}

      {menu && (
        <PhotoMenu req={req} count={paths.length} mealMode={mealMode}
          onClose={() => setMenu(false)}
          onView={() => { setMenu(false); setViewing(true) }}
          onCaption={mealMode && onCaption ? () => { setMenu(false); onCaption() } : null}
          onReplace={canPick ? () => { setMenu(false); inputRef.current?.click() } : null}
          addMore={req.multi && canAddMore}
          onRemove={() => { setMenu(false); onClear() }} />
      )}
      {viewing && (
        <Lightbox path={paths[paths.length - 1]} label={req.label}
          caption={entry?.caption} stats={mealMode ? mealStats(entry) : []}
          onClose={() => setViewing(false)} />
      )}
    </label>
  )
}

// What to do with a photo you already took. Removal is last, separated, and
// says what it keeps, because it is the only one you cannot undo.
function PhotoMenu({ req, count, mealMode, onClose, onView, onCaption, onReplace, addMore, onRemove }) {
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn() }
  return createPortal(
    <div className="pm-wrap" onPointerDown={stop(onClose)}>
      <div className="pm" onPointerDown={(e) => e.stopPropagation()}>
        <div className="pm-head">{req.label}</div>
        <button className="pm-item" onClick={stop(onView)}>
          <Icon name="expand" size={17} />
          {count > 1 ? `See photo (${count})` : 'See photo'}{mealMode ? ' and macros' : ''}
        </button>
        {onCaption && (
          <button className="pm-item" onClick={stop(onCaption)}>
            <Icon name="edit" size={17} />Edit description
          </button>
        )}
        {onReplace && (
          <button className="pm-item" onClick={stop(onReplace)}>
            <Icon name="camera" size={17} />{addMore ? 'Add another photo' : 'Replace photo'}
          </button>
        )}
        <button className="pm-item danger" onClick={stop(onRemove)}>
          <Icon name="x" size={17} />Remove {count > 1 ? `photos (${count})` : 'photo'}
          {mealMode && <small>description and macros stay</small>}
        </button>
        <button className="pm-cancel" onClick={stop(onClose)}>Cancel</button>
      </div>
    </div>,
    document.body
  )
}

// Built-in countdown proof (Miska/her sister, 2026-07-18): tap to start,
// finish the minutes, and the item checks itself — no separate clock app.
// endsAt persists in localStorage so backgrounding the phone or reopening the
// app mid-meditation doesn't lose the session; a timer that expired while the
// app was closed completes on the next mount.
function TimerTile({ req, entry, editable, busy, todayStr, onComplete, onClear }) {
  const done = entrySatisfies(req, entry)
  const target = req.minMinutes || 10
  const storeKey = `ym-timer-${req.id}-${todayStr}`
  const [endsAt, setEndsAt] = useState(() => {
    const v = Number(localStorage.getItem(storeKey))
    return v > Date.now() ? v : (v ? -1 : null) // -1 = expired while away
  })
  const [now, setNow] = useState(Date.now())
  const firedRef = useRef(false)

  const running = !done && endsAt && endsAt > now
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  // Completion: countdown hit zero (or had already expired while away).
  useEffect(() => {
    const expired = endsAt === -1 || (endsAt && endsAt > 0 && now >= endsAt)
    if (done || !expired || firedRef.current) return
    firedRef.current = true
    localStorage.removeItem(storeKey)
    setEndsAt(null)
    onComplete()
  }, [now, endsAt, done, storeKey, onComplete])

  const start = () => {
    const ends = Date.now() + target * 60000
    try { localStorage.setItem(storeKey, String(ends)) } catch { /* private mode */ }
    firedRef.current = false
    setEndsAt(ends)
    setNow(Date.now())
  }
  const cancel = () => {
    localStorage.removeItem(storeKey)
    setEndsAt(null)
  }

  const left = running ? Math.max(0, endsAt - now) : 0
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`

  return (
    <button className={'watertoggle' + (done ? ' on' : '')} disabled={!editable || busy}
      onClick={done ? onClear : running ? cancel : start}
      style={{ marginBottom: 8, opacity: busy ? 0.6 : undefined }}>
      <span className="wt-box" style={done ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}>
        {done ? <Icon name="check" size={18} /> : running ? null : <Icon name="clock" size={16} />}
        {running && <span className="wt-count" style={{ fontSize: 10 }}>{mmss}</span>}
      </span>
      <span style={{ flex: 1 }}>
        <span className="wt-title" style={{ display: 'block' }}>{req.label}</span>
        <span className="wt-hint" style={running ? { color: 'var(--blue)' } : undefined}>
          {busy ? 'Saving…'
            : done ? `Done ✓ · ${target} min in the books`
            : running ? `${mmss} to go — stay with it (tap to cancel)`
            : `${target} min — tap to start the timer`}
        </span>
      </span>
      <Icon name={req.icon || 'clock'} size={22} style={{ color: done ? 'var(--blue)' : running ? 'var(--blue)' : 'var(--muted-2)' }} />
    </button>
  )
}

// Ad-hoc extra meal: a dashed "+" tile that shoots straight into the next
// free extra slot; the resulting tile is captioned like any meal.
export function AddMealSlot({ uploading, onPick, captureOnly }) {
  return (
    <label className={'slot add-meal' + (uploading ? ' uploading' : '')}>
      <span className="slot-ic"><Icon name="plus" size={24} strokeWidth={2.2} /></span>
      <span className="slot-label">Add a meal</span>
      <span className="slot-hint">{uploading ? 'Uploading…' : 'optional · counts toward your goal'}</span>
      {IS_MOBILE && <input type="file" accept="image/*" capture={captureOnly ? 'environment' : undefined}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f) }} />}
    </label>
  )
}

function StatusBanner({ approved, rejected, complete, note, doneCount, total, hasReferee, t }) {
  if (approved) {
    return (
      <div className="daybanner done">
        <div className="db-title" style={{ color: 'var(--green)' }}>{t('today.banner.approved.title')}</div>
        <div className="db-sub">{t('today.banner.approved.sub', { note })}</div>
      </div>
    )
  }
  if (rejected) {
    return (
      <div className="daybanner rejected">
        <div className="db-title" style={{ color: 'var(--red)' }}>{t('today.banner.rejected.title')}</div>
        <div className="db-sub">{t('today.banner.rejected.sub', { note })}</div>
      </div>
    )
  }
  if (complete) {
    return hasReferee ? (
      <div className="daybanner review">
        <div className="db-title" style={{ color: 'var(--amber)' }}>{t('today.banner.review.title')}</div>
        <div className="db-sub">{t('today.banner.review.sub')}</div>
      </div>
    ) : (
      <div className="daybanner done">
        <div className="db-title" style={{ color: 'var(--green)' }}>{t('today.banner.done.title')}</div>
        <div className="db-sub">{t('today.banner.done.sub')}</div>
      </div>
    )
  }
  return (
    <div className="daybanner">
      <div className="db-title">{t('today.banner.togo.title', { k: total - doneCount })}</div>
      <div className="db-sub">{t('today.banner.togo.sub', { total })}</div>
    </div>
  )
}

// Two modes on purpose. With a target, this is a progress bar you fill (or a
// ceiling you stay under). WITHOUT one it is just a number — no bar, no
// colour, nothing implying you did well or badly. Someone who asked to see
// their fiber did not ask to be graded on it.
function MacroRow({ label, value, unit, target, max, ceiling }) {
  if (target == null) {
    return (
      <div className="mb-row plain">
        <span className="mb-label">{label}</span>
        <span className="mb-num"><b>{value ? `~${value}` : 0}</b>{unit}</span>
      </div>
    )
  }
  const pct = Math.min(100, Math.round((value / (target || 1)) * 100))
  // Under a ceiling is good; over a floor is good.
  const ok = ceiling ? value <= target : value >= target
  const color = ok ? 'var(--green)' : 'var(--amber)'
  const goalText = max && max !== target ? `${target}–${max}${unit}` : `${ceiling ? '≤' : ''}${target}${unit}`
  return (
    <div className="mb-row">
      <span className="mb-label">{label}</span>
      <div className="bar" style={{ flex: 1 }}>
        <div className="bar-fill" style={{ width: pct + '%', background: color }} />
      </div>
      <span className="mb-num"><b>{value ? `~${value}` : 0}</b>{unit} / {goalText}</span>
    </div>
  )
}

// One-line meal description, edited in a small sheet; the AI reads photo +
// caption to estimate macros, which render on the tile itself.
// A note, written where it lives. It used to open a whole sheet, which is a
// lot of ceremony for one line (Miska): type it, save it, done. Your last
// answer sits above the box, because writing against your own record is the
// part a checkbox cannot do.
export function NoteLine({ req, entry, cfg, editable, previous, badge, onSave }) {
  const saved = (entry?.caption || '').trim()
  const [text, setText] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { setText(saved) }, [saved])
  const done = saved.length >= MIN_NOTE
  const left = MIN_NOTE - text.trim().length
  const dirty = text.trim() !== saved

  async function save() {
    if (left > 0 || busy) return
    setBusy(true)
    try { await onSave(text) } finally { setBusy(false); setOpen(false) }
  }

  return (
    <div className={'noteline' + (done ? ' done' : '')}>
      <div className="nl-head">
        <span className="nl-box">{done ? <Icon name="check" size={14} strokeWidth={3} /> : <Icon name="edit" size={13} />}</span>
        <span className="nl-title">{req.label}</span>
        {badge && <span className="grp-count">{badge}</span>}
        <DueBadge req={req} entry={entry} cfg={cfg} />
      </div>
      {req.hint && <div className="nl-q">{req.hint}</div>}
      {previous && !done && (
        <div className="nl-prev"><b>Last time</b> {previous.text}</div>
      )}
      <div className="nl-row">
        <input className="fr-input nl-in" value={text} disabled={!editable || busy}
          placeholder={done ? '' : 'A line is enough, as long as it is true'}
          onFocus={() => setOpen(true)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        {(dirty || open) && (
          <button className="btn btn-go btn-sm nl-save" disabled={left > 0 || busy || !dirty} onClick={save}>
            {busy ? '…' : left > 0 ? left : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}

export function CaptionSheet({ req, entry, onSave, onClose }) {
  const [text, setText] = useState(entry?.caption || '')
  const [busy, setBusy] = useState(false)
  const submit = () => { if (text.trim() && !busy) { setBusy(true); onSave(text) } }
  return (
    <Sheet onClose={onClose} position="top">
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>{req.label}</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        One line on what it was — the AI reads this plus the photo and updates your macro bar.
      </p>
      <input className="fr-input" style={{ width: '100%' }} autoFocus value={text}
        placeholder="e.g. 6 scrambled eggs + oatmeal with honey"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      {entry?.estProtein != null && (
        <p className="muted" style={{ fontSize: 12, margin: '8px 2px 0' }}>
          current estimate: ~{entry.estProtein}g protein · {entry.estCalories} cal
        </p>
      )}
      <div className="review-actions" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-go" disabled={busy || !text.trim()} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  )
}

// Soft-mode hero: the big centered ring with the serif day number inside and
// an encouraging voice line below. The small Ring stays untouched for dark mode.
function SoftHero({ dayNum, done, total, date, complete, t }) {
  return (
    <div className="soft-hero">
      <div className="section-label" style={{ margin: 0 }}>Today · {date}</div>
      <HeroRing done={done} total={total} dayNum={dayNum} />
      <p className="sh-line">
        {complete ? t('today.hero.done') : t('today.hero.encourage', { k: total - done, total })}
      </p>
    </div>
  )
}

function HeroRing({ done, total, dayNum }) {
  const size = 190, sw = 10, r = size / 2 - sw - 2
  const c = 2 * Math.PI * r
  const off = c * (1 - (total ? done / total : 0))
  const colr = done === total && total > 0 ? 'var(--green)' : 'var(--brand)'
  const mid = size / 2
  return (
    <svg width={size} height={size} className="ring sh-ring">
      <circle className="ring-bg" cx={mid} cy={mid} r={r} fill="none" strokeWidth={sw} />
      <circle cx={mid} cy={mid} r={r} fill="none" strokeWidth={sw} stroke={colr}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)' }} />
      {/* .ring rotates -90deg; counter-rotate the text. Explicit y offsets, not
          dominant-baseline (iOS Safari is unreliable with webfont metrics). */}
      <text x={mid} y={mid - 4} textAnchor="middle" className="sh-day" transform={`rotate(90 ${mid} ${mid})`}>Day {dayNum}</text>
      <text x={mid} y={mid + 26} textAnchor="middle" className="sh-count" transform={`rotate(90 ${mid} ${mid})`}>{done} of {total}</text>
    </svg>
  )
}

function Ring({ done, total }) {
  const r = 26
  const c = 2 * Math.PI * r
  const pct = total ? done / total : 0
  const off = c * (1 - pct)
  const colr = done === total && total > 0 ? 'var(--green)' : 'var(--amber)'
  return (
    <svg width="68" height="68" className="ring">
      <circle className="ring-bg" cx="34" cy="34" r={r} fill="none" strokeWidth="6" />
      <circle cx="34" cy="34" r={r} fill="none" strokeWidth="6" stroke={colr} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset .5s ease' }} />
      <text x="34" y="34" textAnchor="middle" dominantBaseline="central" className="ring-label" transform="rotate(90 34 34)">{done}/{total}</text>
    </svg>
  )
}
