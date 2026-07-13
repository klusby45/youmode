// ─────────────────────────────────────────────────────────────────────────
// challenge.js — the correctness core (v2).
// All day / streak / fail / goal math. Pure functions, no React, no Supabase.
// Requirements are now dynamic (per member); an entry satisfies a requirement
// when it has a photo (kind: photo) or is checked (kind: check).
// Honor mode: challenges with no referee auto-approve completed days.
// ─────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000

// 'YYYY-MM-DD' for "now" in the given IANA timezone. en-CA renders ISO order.
export function todayInTz(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
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
export function entrySatisfies(req, entry) {
  if (!entry) return false
  return req.kind === 'photo' ? !!(entry.photoPaths?.length || entry.photoPath) : !!entry.checked
}

// Optional items (e.g. a bonus protein-shake slot) never gate completeness —
// they render as tiles but don't count toward the daily X/N.
const required = (reqs) => reqs.filter((r) => !r.optional)

export function isLogComplete(reqs, log) {
  const must = required(reqs)
  if (!log || !must.length) return false
  return must.every((r) => entrySatisfies(r, log.entriesByReq?.[r.id]))
}

export function logDone(reqs, log) {
  return required(reqs).filter((r) => entrySatisfies(r, log?.entriesByReq?.[r.id])).length
}

export function logTotal(reqs) {
  return required(reqs).length
}

// ── day state ─────────────────────────────────────────────────────────────
//   'upcoming' | 'active' | 'pending' | 'approved' | 'fail'
// hasReferee=false (honor mode): a complete day counts as approved.
export function dayState(n, { startStr, todayStr, totalDays, logsByDate, reqs, hasReferee }) {
  if (n < 1 || n > totalDays) return 'upcoming'
  const date = dayDate(startStr, n)
  const log = logsByDate[date]
  const cmp = daysBetween(todayStr, date) // >0 future, 0 today, <0 past

  if (cmp > 0) return 'upcoming'

  const complete = isLogComplete(reqs, log)
  if (log?.status === 'approved') return 'approved'
  if (log?.status === 'rejected') return 'fail'
  if (complete) return hasReferee ? 'pending' : 'approved'
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

  let approved = 0, failed = 0, pending = 0
  const states = []
  for (let n = 1; n <= totalDays; n++) {
    const s = dayState(n, { startStr, todayStr, totalDays, logsByDate, reqs, hasReferee })
    states[n] = s
    if (s === 'approved') approved++
    else if (s === 'fail') failed++
    else if (s === 'pending') pending++
  }

  let streak = 0
  for (let n = Math.min(totalDays, dayNum - 1); n >= 1; n--) {
    if (states[n] === 'approved') streak++
    else break
  }
  let best = 0, run = 0
  for (let n = 1; n <= totalDays; n++) {
    if (states[n] === 'approved') { run++; best = Math.max(best, run) }
    else run = 0
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

// Same-day-only editing (prevents backfilling a past day to dodge a fail).
export function canEditDay(logDate, config) {
  return logDate === config.todayStr
}

// Challenge format governs standings layout + framing. When a challenge has no
// explicit format (created before the feature), derive it from participant
// count so existing challenges render sensibly.
export function deriveFormat(participantCount) {
  if (participantCount <= 1) return 'solo'
  if (participantCount === 2) return 'versus'
  return 'community'
}
