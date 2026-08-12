// ─────────────────────────────────────────────────────────────────────────
// challenge.js — the correctness core (v2).
// All day / streak / fail / goal math. Pure functions, no React, no Supabase.
// Requirements are now dynamic (per member); an entry satisfies a requirement
// when it has a photo (kind: photo) or is checked (kind: check).
// Honor mode: challenges with no referee auto-approve completed days.
// ─────────────────────────────────────────────────────────────────────────

import { isMealReq } from '../config.js'

const MS_PER_DAY = 86_400_000

// 'YYYY-MM-DD' for "now" in the given IANA timezone. en-CA renders ISO order.
// Which day is it, for this person, right now.
//
// dayEndHour shifts the boundary out of midnight. At 12:45am with a 2am
// rollover we look back two hours, land on 10:45pm, and return YESTERDAY's
// date: which is the honest answer, because "in bed by 1am" belongs to the
// night it started, not to the calendar page that just turned over.
export function todayInTz(tz, dayEndHour = 0) {
  const at = dayEndHour ? new Date(Date.now() - dayEndHour * 3600000) : new Date()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

function toUTC(dateStr) {
  return Date.parse(dateStr + 'T00:00:00Z')
}

export function daysBetween(aStr, bStr) {
  return Math.round((toUTC(bStr) - toUTC(aStr)) / MS_PER_DAY)
}

export function addDays(dateStr, n) {
  return new Date(toUTC(dateStr) + n * MS_PER_DAY).toISOString().slice(0, 10)
}

// The calendar date for day N of the challenge (day 1 === start_date).
export function dayDate(startStr, n) {
  return addDays(startStr, n - 1)
}

// Which day number is "today". Can be < 1 (not started) or > totalDays (over).
export function currentDayNumber(startStr, todayStr) {
  return daysBetween(startStr, todayStr) + 1
}

// ── entries ───────────────────────────────────────────────────────────────
// A log is { ..., entriesByReq: { [requirementId]: entry } }.

// How many completions a check entry carries today. Rows written before the
// check_count column existed only have the boolean, so fall back to 0/1.
export function checkCount(entry) {
  if (!entry) return 0
  return entry.checkCount ?? (entry.checked ? 1 : 0)
}

export function entrySatisfies(req, entry) {
  if (!entry) return false
  if (req.kind === 'photo') return !!(entry.photoPaths?.length || entry.photoPath)
  const target = req.timesPerDay || 1
  return target > 1 ? checkCount(entry) >= target : !!entry.checked
}

// The daily-mandatory set. Some items never gate a day's X/N:
//   • optional items (e.g. a bonus protein-shake slot), and
//   • weekly/monthly-cadence items (e.g. "soccer 2x/week", "massage 1x a
//     month") — you can't do them every day, so they'd wrongly fail most
//     days. They get their own display-only progress (weeklyProgress /
//     monthlyProgress); they never touch dayState.
const isDaily = (r) => r.frequency !== 'weekly' && r.frequency !== 'monthly'
const required = (reqs) => reqs.filter((r) => !r.optional && isDaily(r))

// Meal photos are FUNGIBLE. A day asks for a NUMBER of meal photos, not for
// specific numbered boxes: eating your second meal and logging it in the
// "Extra Meal" slot still means you ate it and photographed it. So every daily
// meal photo — the numbered slots AND the optional extras/shake slots — forms
// one pool, and the day's meal duty is met once that pool holds as many photos
// as there are required meal slots. Without this, an honest day fails purely
// because real food landed in the "wrong" slot (Kyle, 2026-07-25: logged a
// 951-cal smoothie as "Extra Meal" instead of "Meal 2").
// Optional meal slots still never ADD to the target; they only help fill it.
const isMealPhoto = (r) => r.kind === 'photo' && isDaily(r) && isMealReq(r)
const mealTarget = (reqs) => reqs.filter((r) => isMealPhoto(r) && !r.optional).length
const mealsLogged = (reqs, log) =>
  reqs.filter((r) => isMealPhoto(r) && entrySatisfies(r, log?.entriesByReq?.[r.id])).length
// Everything that still has to be satisfied slot by slot.
const requiredNonMeal = (reqs) => required(reqs).filter((r) => !isMealPhoto(r))

// Display helper: "3 of 3 meals". met === the meal duty is done for the day.
export function mealProgress(reqs, log) {
  const target = mealTarget(reqs)
  const logged = mealsLogged(reqs, log)
  return { logged, target, met: logged >= target }
}

export function isLogComplete(reqs, log) {
  const must = required(reqs)
  if (!log || !must.length) return false
  if (mealsLogged(reqs, log) < mealTarget(reqs)) return false
  return requiredNonMeal(reqs).every((r) => entrySatisfies(r, log.entriesByReq?.[r.id]))
}

export function logDone(reqs, log) {
  const meals = Math.min(mealTarget(reqs), mealsLogged(reqs, log))
  return requiredNonMeal(reqs).filter((r) => entrySatisfies(r, log?.entriesByReq?.[r.id])).length + meals
}

export function logTotal(reqs) {
  return requiredNonMeal(reqs).length + mealTarget(reqs)
}

// Display-only weekly-cadence progress. Challenge-relative weeks: weekIndex =
// ceil(dayNumber/7), so "this week" = days (w-1)*7+1 .. w*7. For each weekly
// requirement, counts how many days in the current week already have a
// satisfying entry. Never feeds dayState/streak/standings — purely for the
// Today "This week" section.
export function weeklyProgress(reqs, logs, { startStr, dayNumber, totalDays }) {
  const weekly = reqs.filter((r) => r.frequency === 'weekly')
  if (!weekly.length || dayNumber < 1) return {}
  const logsByDate = {}
  for (const l of logs) logsByDate[l.logDate] = l
  const w = Math.ceil(dayNumber / 7)
  const first = (w - 1) * 7 + 1
  const last = totalDays ? Math.min(w * 7, totalDays) : w * 7
  const daysInWeek = Math.max(1, last - first + 1) // a final partial week can be < 7
  const out = {}
  for (const r of weekly) {
    let done = 0
    for (let n = first; n <= last; n++) {
      if (entrySatisfies(r, logsByDate[dayDate(startStr, n)]?.entriesByReq?.[r.id])) done++
    }
    // Clamp the target so a short final week can't show an unreachable goal.
    const target = Math.max(1, Math.min(r.timesPerWeek || 1, daysInWeek))
    out[r.id] = { done, target, met: done >= target }
  }
  return out
}

// Monthly cadence, same idea as weeklyProgress but over challenge-relative
// 30-day blocks (month 1 = days 1-30), so "1× a month" reads consistently no
// matter what calendar date the challenge started.
export function monthlyProgress(reqs, logs, { startStr, dayNumber, totalDays }) {
  const monthly = reqs.filter((r) => r.frequency === 'monthly')
  if (!monthly.length || dayNumber < 1) return {}
  const logsByDate = {}
  for (const l of logs) logsByDate[l.logDate] = l
  const m = Math.ceil(dayNumber / 30)
  const first = (m - 1) * 30 + 1
  const last = totalDays ? Math.min(m * 30, totalDays) : m * 30
  const daysInMonth = Math.max(1, last - first + 1) // a final partial block can be < 30
  const out = {}
  for (const r of monthly) {
    let done = 0
    for (let n = first; n <= last; n++) {
      if (entrySatisfies(r, logsByDate[dayDate(startStr, n)]?.entriesByReq?.[r.id])) done++
    }
    const target = Math.max(1, Math.min(r.timesPerMonth || 1, daysInMonth))
    out[r.id] = { done, target, met: done >= target }
  }
  return out
}

// ── day state ─────────────────────────────────────────────────────────────
//   'upcoming' | 'active' | 'pending' | 'approved' | 'excused' | 'fail'
// hasReferee=false (honor mode): a complete day counts as approved.
// redemptionDate is the ONE day this member spent their save on (or null).
export function dayState(n, { startStr, todayStr, totalDays, logsByDate, reqs, hasReferee, redemptionDate }) {
  if (n < 1 || n > totalDays) return 'upcoming'
  const date = dayDate(startStr, n)
  const log = logsByDate[date]
  const cmp = daysBetween(todayStr, date) // >0 future, 0 today, <0 past

  if (cmp > 0) return 'upcoming'

  const complete = isLogComplete(reqs, log)
  if (log?.status === 'approved') return 'approved'
  if (log?.status === 'rejected') return 'fail'
  if (complete) return hasReferee ? 'pending' : 'approved'
  // The one save: an incomplete past day the member redeemed doesn't auto-fail.
  // With a referee it waits on their verdict (approve -> 'approved' above,
  // reject -> 'fail' above, so their call always wins). On the honor system
  // there's nobody to ask, so it's 'excused': not a fail, not a day passed.
  if (cmp < 0 && redemptionDate && date === redemptionDate) return hasReferee ? 'pending' : 'excused'
  return cmp === 0 ? 'active' : 'fail'
}

// ── member roll-up ────────────────────────────────────────────────────────
export function summarize(member, reqs, logs, config) {
  const { startStr, todayStr, hasReferee } = config
  // A member can run longer than the shared challenge (personal extension).
  const totalDays = member.totalDays || config.totalDays
  const logsByDate = {}
  for (const l of logs) logsByDate[l.logDate] = l

  const dayNum = currentDayNumber(startStr, todayStr)
  const clampedDay = Math.max(0, Math.min(totalDays, dayNum))
  const started = dayNum >= 1
  const finished = dayNum > totalDays

  // The one save the member spent, if any (see dayState).
  const redemptionDate = member?.redemptionDate || null

  let approved = 0, failed = 0, pending = 0, excused = 0
  const states = []
  for (let n = 1; n <= totalDays; n++) {
    const s = dayState(n, { startStr, todayStr, totalDays, logsByDate, reqs, hasReferee, redemptionDate })
    states[n] = s
    if (s === 'approved') approved++
    else if (s === 'fail') failed++
    else if (s === 'pending') pending++
    else if (s === 'excused') excused++
  }

  // An excused day doesn't extend a streak (nothing was done) but it doesn't
  // break it either — that's the whole point of the save. Skip over it.
  let streak = 0
  for (let n = Math.min(totalDays, dayNum - 1); n >= 1; n--) {
    if (states[n] === 'approved') streak++
    else if (states[n] === 'excused') continue
    else break
  }
  let best = 0, run = 0
  for (let n = 1; n <= totalDays; n++) {
    if (states[n] === 'approved') { run++; best = Math.max(best, run) }
    else if (states[n] !== 'excused') run = 0
  }

  return {
    member,
    reqs,
    states,
    totalDays,
    dayNum,
    clampedDay,
    started,
    finished,
    approved,
    failed,
    pending,
    excused,
    redemptionDate,
    streak,
    bestStreak: best,
    forfeitTriggered: failed > 0,
    daysRemaining: Math.max(0, totalDays - clampedDay),
    completionPct: totalDays ? Math.round((approved / totalDays) * 100) : 0,
    todayState: states[clampedDay] || 'upcoming',
    logsByDate,
  }
}

// ── optional professional goal (per member) ───────────────────────────────
export const LAUNCH_BY_DAY = 30
export function goalStatus(member, config) {
  if (!member.goalLabel) return null
  const { startStr, todayStr, totalDays } = config
  const launchDeadline = dayDate(startStr, LAUNCH_BY_DAY)
  const finalDeadline = dayDate(startStr, totalDays)
  const daysToLaunch = daysBetween(todayStr, launchDeadline)
  const daysToFinal = daysBetween(todayStr, finalDeadline)
  const count = member.goalCurrentCount || 0
  const target = member.goalTargetCount
  return {
    label: member.goalLabel,
    countLabel: member.goalCountLabel,
    launched: !!member.goalLaunched,
    launchedAt: member.goalLaunchedAt || null,
    launchDeadline,
    finalDeadline,
    daysToLaunch,
    daysToFinal,
    launchOverdue: !member.goalLaunched && daysToLaunch < 0,
    count,
    target,
    countPct: target ? Math.min(100, Math.round((count / target) * 100)) : 0,
    countMet: target ? count >= target : false,
  }
}

// How far back the one save can reach. A week: long enough that noticing a
// missed day late still leaves you a way out, short enough that it can't
// rewrite an old result in a challenge someone has a stake on.
export const SAVE_WINDOW_DAYS = 7

// Same-day-only editing (prevents backfilling a past day to dodge a fail).
// The ONE exception is the day you spent your save on: you've already paid for
// it, it's one per challenge, and a referee still rules on the result — so
// letting you attach the proof you forgot to log beats making them judge a
// blank day on your word. No other past day ever opens.
export function canEditDay(logDate, config, redemptionDate) {
  if (logDate === config.todayStr) return true
  return !!redemptionDate && logDate === redemptionDate
}

// Challenge format governs standings layout + framing. When a challenge has no
// explicit format (created before the feature), derive it from participant
// count so existing challenges render sensibly.
export function deriveFormat(participantCount) {
  if (participantCount <= 1) return 'solo'
  if (participantCount === 2) return 'versus'
  return 'community'
}
