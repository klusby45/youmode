import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { usernameToEmail, MEMBER_COLORS } from './config.js'

// Shared "somewhere" Supabase project (same as the crm app). The anon key is
// safe in the client — RLS is the real gate.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://aqaubrbssnbtomykexgr.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxYXVicmJzc25idG9teWtleGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDgxNDEsImV4cCI6MjA4OTcyNDE0MX0.8Wr6gmd_AzCilBgzqRy849GhLMZdxBhlpQwCDzlXc0M'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const ACTIVE_KEY = '75hard-active-challenge'

// ─── normalizers (snake_case DB → camelCase app) ─────────────────────────
const nProfile = (r) => r && ({
  id: r.id, username: r.username, displayName: r.display_name, email: r.email, phone: r.phone,
  theme: r.theme ?? null, tone: r.tone ?? null,
  // Their own clock. Null timezone follows the challenge; 0 is midnight.
  // Both undefined pre-migration, which reads the same as the old behaviour.
  timezone: r.timezone ?? null, dayEndHour: r.day_end_hour ?? 0,
  photoSharing: r.photo_sharing ?? null, // null = 'icons' (photos private by default)
})
const nChallenge = (r) => r && ({
  id: r.id, name: r.name, joinCode: r.join_code, ownerId: r.owner_id,
  startDate: r.start_date, timezone: r.timezone, totalDays: r.total_days,
  format: r.format ?? null, // 'solo'|'versus'|'accountability'|'community'; null = derive from size
})
const nMember = (r) => r && ({
  id: r.id, challengeId: r.challenge_id, userId: r.user_id, role: r.role,
  totalDays: r.total_days ?? null, // personal day-count override (e.g. Dylen's 90)
  stakeText: r.stake_text, stakeImage: r.stake_image, accent: r.accent,
  goalLabel: r.goal_label, goalTargetCount: r.goal_target_count,
  goalCountLabel: r.goal_count_label, goalLaunched: r.goal_launched,
  goalLaunchedAt: r.goal_launched_at, goalCurrentCount: r.goal_current_count,
  displayName: r.profiles?.display_name || r.display_name || '',
  photoSharing: r.profiles?.photo_sharing ?? null, // owner's account-level photo privacy
  // One-time save: null until spent, then the date it was spent on. Undefined
  // (not null) pre-migration — treated the same everywhere: nothing spent.
  redemptionDate: r.redemption_date ?? null,
})
const nReq = (r) => r && ({
  id: r.id, challengeId: r.challenge_id, userId: r.user_id, key: r.key,
  label: r.label, hint: r.hint, group: r.group_label, icon: r.icon,
  kind: r.kind, sort: r.sort,
  multi: !!r.multi, minMinutes: r.min_minutes ?? null, optional: !!r.optional,
  isPrivate: !!r.is_private, // per-item override: others see icon + caption only
  frequency: r.frequency || 'daily', timesPerWeek: r.times_per_week ?? null, // weekly cadence
  timesPerDay: r.times_per_day ?? null, // check items: completions needed per day (null/1 = once)
  timesPerMonth: r.times_per_month ?? null, // monthly cadence target
  captureOnly: !!r.capture_only, // photo items: camera-only (no uploads) when true
  dueBy: r.due_by ?? null, // minutes after midnight this is due; null = anytime
  sleepBy: r.sleep_by ?? null, wakeBy: r.wake_by ?? null, // both set = a sleep screenshot item
})
const nEntry = (r) => r && ({
  id: r.id, dayLogId: r.day_log_id, requirementId: r.requirement_id,
  challengeId: r.challenge_id, userId: r.user_id, photoPath: r.photo_path,
  photoPaths: r.photo_paths?.length ? r.photo_paths : (r.photo_path ? [r.photo_path] : []),
  checked: r.checked, checkCount: r.check_count ?? null,
  aiFlag: r.ai_flag, aiNote: r.ai_note, aiDismissed: r.ai_dismissed,
  loggedAt: r.logged_at ?? null, // when proof first landed, for on-time checks
  caption: r.caption ?? null, estProtein: r.est_protein ?? null, estCalories: r.est_calories ?? null,
  // Full macro set (est_* columns land with supabase/macro-columns.sql).
  // Undefined pre-migration, which reads the same as null everywhere.
  estCarbs: r.est_carbs ?? null, estFat: r.est_fat ?? null,
  estSatFat: r.est_sat_fat ?? null, estFiber: r.est_fiber ?? null,
  estSodium: r.est_sodium ?? null, estSugar: r.est_sugar ?? null,
})
const nPlan = (r) => r && ({
  id: r.id, userId: r.user_id, goalText: r.goal_text, startWeight: r.start_weight,
  targetWeight: r.target_weight, targetDate: r.target_date,
  proteinMin: r.protein_min, proteinMax: r.protein_max,
  calorieTarget: r.calorie_target, rateTarget: r.rate_target, createdAt: r.created_at,
  // Nutrition preferences, independent of any weight goal. 'aware' = numbers
  // with no targets; 'targets' = show progress against the fields below.
  nutritionMode: r.nutrition_mode ?? null,
  fiberTarget: r.fiber_target ?? null, satFatMax: r.sat_fat_max ?? null,
  sodiumMax: r.sodium_max ?? null, sugarMax: r.sugar_max ?? null,
  // A row with no weight fields is nutrition-only, not half-filled.
  hasBodyGoal: r.target_weight != null || r.rate_target != null,
})
const nLab = (r) => r && ({
  id: r.id, userId: r.user_id, drawnOn: r.drawn_on, panelName: r.panel_name,
  markers: Array.isArray(r.markers) ? r.markers : [], createdAt: r.created_at,
})
const nWeighIn = (r) => r && ({ id: r.id, userId: r.user_id, date: r.weigh_date, weight: Number(r.weight) })
const nLog = (r) => r && ({
  id: r.id, challengeId: r.challenge_id, userId: r.user_id, logDate: r.log_date,
  status: r.status, judgeNote: r.judge_note, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
  entriesByReq: Object.fromEntries((r.log_entries || []).map((e) => [e.requirement_id, nEntry(e)])),
})

// ─── auth ────────────────────────────────────────────────────────────────
export async function signIn(usernameOrEmail, password) {
  const id = usernameOrEmail.trim()
  let email = id
  if (!id.includes('@')) {
    const { data, error } = await supabase.rpc('email_for_username', { u: id })
    if (error) throw error
    if (!data) throw new Error('No account with that username')
    email = data
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.user.id
}

// Availability probe for the staged signup's first step. Fails open on
// errors — signUp's own pre-check below still guards the actual create.
export async function usernameTaken(username) {
  try {
    const { data } = await supabase.rpc('email_for_username', { u: username.trim().toLowerCase() })
    return !!data
  } catch { return false }
}

export async function signUp({ username, password, email, phone = null }) {
  const uname = username.trim().toLowerCase()
  const { data: taken } = await supabase.rpc('email_for_username', { u: uname })
  if (taken) throw new Error('That username is taken')
  const { data, error } = await supabase.auth.signUp({ email: usernameToEmail(uname), password })
  if (error) throw error
  if (!data.session) throw new Error('Signup needs email confirmation disabled in Supabase. Ask the admin.')
  const display = uname.charAt(0).toUpperCase() + uname.slice(1)
  // Real email is stored on the profile (for password recovery); the auth
  // login still uses the synthetic username email. New accounts start in Coach
  // voice; strip-and-retry keeps signup working before the tone column lands.
  const base = { id: data.user.id, username: uname, display_name: display, phone: phone || null, role: 'participant', email: email?.trim().toLowerCase() || null }
  let { error: pe } = await supabase.from('profiles').insert({ ...base, tone: 'coach' })
  if (pe && /tone/i.test(pe.message || '')) ({ error: pe } = await supabase.from('profiles').insert(base))
  if (pe) throw pe
  return data.user.id
}

// Timezone and day rollover, per person. A clear error rather than a silent
// no-op if the migration has not been pasted yet.
export async function saveDayClock(userId, { timezone, dayEndHour }) {
  const patch = {}
  if (timezone !== undefined) patch.timezone = timezone || null
  if (dayEndHour !== undefined) patch.day_end_hour = Math.max(0, Math.min(5, Number(dayEndHour) || 0))
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  if (error && /timezone|day_end_hour|column/i.test(error.message || '')) {
    throw new Error('Time settings need a quick server update. Ping Kyle.')
  }
  if (error) throw error
}

// Recovery email (stored on profile; used only for password reset + contact).
// The name other people see. Signup no longer asks for one (it asked over a
// username field, which conflated the two), so this is where it gets set.
export async function saveDisplayName(userId, displayName) {
  const name = (displayName || '').trim().slice(0, 40)
  if (!name) throw new Error('Enter a name')
  const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', userId)
  if (error) throw error
}

export async function saveEmail(userId, email) {
  const { error } = await supabase.from('profiles').update({ email: email?.trim().toLowerCase() || null }).eq('id', userId)
  if (error) throw error
}

// Password reset (server-side; delivers a link to the real email on file).
export async function requestReset(identifier) {
  const res = await fetch(`${API_BASE}/api/request-reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Could not send the reset email') }
}

export async function resetPassword(token, password) {
  const res = await fetch(`${API_BASE}/api/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Could not reset your password') }
}

// Persist the user's colorway. Pre-migration (no profiles.theme column yet)
// this fails silently — the picker still works device-locally.
export async function saveTheme(userId, theme) {
  const { error } = await supabase.from('profiles').update({ theme }).eq('id', userId)
  if (error && !/theme/i.test(error.message || '')) throw error
}

// Persist the user's voice (copy tone) — same pre-migration tolerance.
export async function saveTone(userId, tone) {
  const { error } = await supabase.from('profiles').update({ tone }).eq('id', userId)
  if (error && !/tone/i.test(error.message || '')) throw error
}

// Account-level photo privacy: 'all' (challenge-mates see photos) or 'icons'.
export async function savePhotoSharing(userId, value) {
  const { error } = await supabase.from('profiles').update({ photo_sharing: value }).eq('id', userId)
  if (error && !/photo_sharing/i.test(error.message || '')) throw error
}

// Per-requirement privacy lock (own items only, RLS-enforced).
export async function setReqPrivacy(reqId, isPrivate) {
  const { error } = await supabase.from('requirements').update({ is_private: isPrivate }).eq('id', reqId)
  if (error && !/is_private/i.test(error.message || '')) throw error
}

// Permanently delete the signed-in user's account + all their data (App
// Store requirement). Server-side (service key) handles the cascade; here we
// just authorize with the session token and then clear the local session.
export async function deleteAccount() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(`${API_BASE}/api/delete-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Could not delete your account')
  }
  try { await supabase.auth.signOut() } catch { /* session is gone anyway */ }
  localStorage.removeItem(ACTIVE_KEY)
}

export async function signOut() {
  try { await supabase.auth.signOut() } catch { /* ignore */ }
  localStorage.removeItem(ACTIVE_KEY)
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// ─── bootstrap ────────────────────────────────────────────────────────────
export function getActiveChallengeId() { return localStorage.getItem(ACTIVE_KEY) }
export function setActiveChallengeId(id) { localStorage.setItem(ACTIVE_KEY, id) }

export async function loadAll(userId) {
  const [prof, mems] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('members').select('*, challenges(*)').eq('user_id', userId),
  ])
  if (prof.error) throw prof.error
  if (mems.error) throw mems.error
  const profile = nProfile(prof.data)
  const challenges = (mems.data || []).map((m) => nChallenge(m.challenges)).filter(Boolean)
  if (!profile || !challenges.length) return { profile, challenges: [], active: null }

  let cid = getActiveChallengeId()
  if (!challenges.some((c) => c.id === cid)) cid = challenges[0].id
  setActiveChallengeId(cid)

  // Members carry their profile's photo_sharing; retry with the legacy
  // embed pre-migration (an unknown embedded column fails the whole query).
  let allMembers = await supabase.from('members').select('*, profiles(display_name, photo_sharing)').eq('challenge_id', cid).order('joined_at')
  if (allMembers.error && /photo_sharing/i.test(allMembers.error.message || '')) {
    allMembers = await supabase.from('members').select('*, profiles(display_name)').eq('challenge_id', cid).order('joined_at')
  }
  const [ch, reqs, logs] = await Promise.all([
    supabase.from('challenges').select('*').eq('id', cid).single(),
    supabase.from('requirements').select('*').eq('challenge_id', cid).order('sort'),
    supabase.from('day_logs').select('*, log_entries(*)').eq('challenge_id', cid),
  ])
  for (const q of [ch, allMembers, reqs, logs]) if (q.error) throw q.error

  // Body plans + weigh-ins for everyone in the challenge (optional feature;
  // tolerate the tables not existing yet pre-migration).
  let plans = []
  let weighIns = []
  try {
    const uids = allMembers.data.map((m) => m.user_id)
    const [pl, wi] = await Promise.all([
      supabase.from('body_plans').select('*').in('user_id', uids).order('created_at'),
      supabase.from('weigh_ins').select('*').in('user_id', uids).order('weigh_date'),
    ])
    if (!pl.error) plans = pl.data.map(nPlan)
    if (!wi.error) weighIns = wi.data.map(nWeighIn)
  } catch { /* pre-migration */ }

  return {
    profile,
    challenges,
    active: {
      challenge: nChallenge(ch.data),
      members: allMembers.data.map(nMember),
      requirements: reqs.data.map(nReq),
      logs: logs.data.map(nLog),
      plans,
      weighIns,
    },
  }
}

// ─── challenge lifecycle ──────────────────────────────────────────────────
const genCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('')

export async function createChallenge({ name, format, startDate, timezone, stakeText, items, dayCount }, userId) {
  const total = dayCount ? Math.min(365, Math.max(7, Math.round(dayCount))) : null
  let challenge = null
  for (let i = 0; i < 4 && !challenge; i++) {
    const base = { name, join_code: genCode(), owner_id: userId, start_date: startDate, timezone }
    if (total) base.total_days = total
    let { data, error } = await supabase.from('challenges').insert({ ...base, format: format || null }).select().single()
    // Strip the format column and retry if the migration hasn't landed yet.
    if (error && /format/i.test(error.message || '')) ({ data, error } = await supabase.from('challenges').insert(base).select().single())
    if (!error) challenge = data
    else if (!/duplicate|unique/i.test(error.message)) throw error
  }
  if (!challenge) throw new Error('Could not generate a join code — try again')

  const { error: me } = await supabase.from('members').insert({
    challenge_id: challenge.id, user_id: userId, role: 'participant',
    stake_text: stakeText || null, accent: MEMBER_COLORS[0],
  })
  if (me) throw me

  await insertRequirementRows(challenge.id, userId, items)

  setActiveChallengeId(challenge.id)
  return nChallenge(challenge)
}

// Insert checklist rows; retries without the newer columns pre-migration.
async function insertRequirementRows(challengeId, userId, items) {
  const rows = items.map((it, i) => ({
    challenge_id: challengeId, user_id: userId, key: it.key, label: it.label,
    hint: it.hint || null, group_label: it.group || null, icon: it.icon || (it.kind === 'photo' ? 'camera' : 'bolt'),
    kind: it.kind, sort: i + 1,
    multi: it.kind === 'photo' ? !!it.multi : false,
    min_minutes: it.kind === 'timer' ? (Number(it.minMinutes) || 10)
      : it.kind === 'photo' && it.minMinutes ? Number(it.minMinutes) : null,
    frequency: it.frequency === 'weekly' || it.frequency === 'monthly' ? it.frequency : 'daily',
    times_per_week: it.frequency === 'weekly' ? Math.min(6, Math.max(1, Number(it.timesPerWeek) || 2)) : null,
    times_per_month: it.frequency === 'monthly' ? Math.min(10, Math.max(1, Number(it.timesPerMonth) || 1)) : null,
    times_per_day: it.kind === 'check' && Number(it.timesPerDay) > 1 ? Math.min(6, Math.round(Number(it.timesPerDay))) : null,
    capture_only: it.kind === 'photo' ? !!it.captureOnly : false,
    due_by: it.dueBy ?? null,
    sleep_by: it.sleepBy ?? null,
    wake_by: it.wakeBy ?? null,
  }))
  // Pre-migration repair ladder: strip newer columns, degrade timer→check
  // (the old kind constraint), or BOTH — whichever the error calls for. A
  // timer item created before the SQL lands needs strip AND degrade together.
  const stripNew = ({ multi: _m, min_minutes: _mm, frequency: _f, times_per_week: _t, times_per_day: _d, times_per_month: _tm, capture_only: _c, due_by: _db, sleep_by: _sb, wake_by: _wb, ...r }) => r
  const degradeKind = (r) => (r.kind === 'timer' ? { ...r, kind: 'check' } : r)
  const MIGRATABLE = /kind|multi|min_minutes|frequency|times_per_week|times_per_day|times_per_month|capture_only|due_by|sleep_by|wake_by/
  let { error } = await supabase.from('requirements').insert(rows)
  if (error) {
    for (const candidate of [rows.map(stripNew), rows.map(degradeKind), rows.map(degradeKind).map(stripNew)]) {
      if (!MIGRATABLE.test(error.message || '')) break
      ;({ error } = await supabase.from('requirements').insert(candidate))
      if (!error) break
    }
  }
  if (error) throw error
}

// Rename a challenge (owner only — enforced by the "owner updates challenge"
// RLS policy). Shows up immediately in the topbar + standings on refresh.
export async function renameChallenge(challengeId, name) {
  const clean = (name || '').trim().slice(0, 60)
  if (!clean) throw new Error('Give it a name')
  const { error } = await supabase.from('challenges').update({ name: clean }).eq('id', challengeId)
  if (error) throw error
}

export async function joinChallenge(code, role) {
  const { data, error } = await supabase.rpc('join_challenge', { p_code: code, p_role: role })
  if (error) throw error
  setActiveChallengeId(data)
  return data
}

export async function updateMyMember(memberId, patch) {
  const db = {}
  if ('stakeText' in patch) db.stake_text = patch.stakeText
  if ('goalLabel' in patch) db.goal_label = patch.goalLabel
  if ('launched' in patch) { db.goal_launched = patch.launched; db.goal_launched_at = patch.launchedAt ?? null }
  if ('count' in patch) db.goal_current_count = patch.count
  if ('totalDays' in patch) db.total_days = patch.totalDays // personal run extension
  const { error } = await supabase.from('members').update(db).eq('id', memberId)
  if (error) throw error
}

// Id-preserving checklist sync: updates keep their requirement id (so past
// days' entries stay linked), removed items are deleted, new items inserted.
export async function syncMyRequirements(challengeId, userId, items) {
  const { data: existing, error: ge } = await supabase.from('requirements')
    .select('id').eq('challenge_id', challengeId).eq('user_id', userId)
  if (ge) throw ge
  const keep = new Set(items.map((i) => i.id).filter(Boolean))
  const gone = (existing || []).map((r) => r.id).filter((id) => !keep.has(id))
  if (gone.length) {
    const { error } = await supabase.from('requirements').delete().in('id', gone)
    if (error) throw error
  }
  const rowFor = (it, i) => ({
    key: it.key, label: it.label, hint: it.hint || null, group_label: it.group || null,
    icon: it.icon || (it.kind === 'photo' ? 'camera' : 'bolt'), kind: it.kind, sort: i + 1,
    multi: it.kind === 'photo' ? !!it.multi : false,
    min_minutes: it.kind === 'timer' ? (Number(it.minMinutes) || 10)
      : it.kind === 'photo' && it.minMinutes ? Number(it.minMinutes) : null,
    frequency: it.frequency === 'weekly' || it.frequency === 'monthly' ? it.frequency : 'daily',
    times_per_week: it.frequency === 'weekly' ? Math.min(6, Math.max(1, Number(it.timesPerWeek) || 2)) : null,
    times_per_month: it.frequency === 'monthly' ? Math.min(10, Math.max(1, Number(it.timesPerMonth) || 1)) : null,
    times_per_day: it.kind === 'check' && Number(it.timesPerDay) > 1 ? Math.min(6, Math.round(Number(it.timesPerDay))) : null,
    capture_only: it.kind === 'photo' ? !!it.captureOnly : false,
    due_by: it.dueBy ?? null,
    sleep_by: it.sleepBy ?? null,
    wake_by: it.wakeBy ?? null,
  })
  // Same pre-migration repair ladder as insertRequirementRows: strip newer
  // columns, degrade timer→check, or both.
  const strip = ({ multi: _m, min_minutes: _mm, frequency: _f, times_per_week: _t, times_per_day: _d, times_per_month: _tm, capture_only: _c, due_by: _db, sleep_by: _sb, wake_by: _wb, ...r }) => r
  const degradeKind = (r) => (r.kind === 'timer' ? { ...r, kind: 'check' } : r)
  const MIGRATABLE = /kind|multi|min_minutes|frequency|times_per_week|times_per_day|times_per_month|capture_only|due_by|sleep_by|wake_by/
  const writeWithRepairs = async (row, write) => {
    let { error } = await write(row)
    if (error) {
      for (const candidate of [strip(row), degradeKind(row), strip(degradeKind(row))]) {
        if (!MIGRATABLE.test(error.message || '')) break
        ;({ error } = await write(candidate))
        if (!error) break
      }
    }
    if (error) throw error
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const row = rowFor(it, i)
    if (it.id) {
      await writeWithRepairs(row, (r) => supabase.from('requirements').update(r).eq('id', it.id))
    } else {
      await writeWithRepairs({ ...row, challenge_id: challengeId, user_id: userId },
        (r) => supabase.from('requirements').insert(r))
    }
  }
}

// ─── daily logging ────────────────────────────────────────────────────────
async function ensureDayLog(challengeId, userId, logDate) {
  const { data, error } = await supabase.from('day_logs')
    .upsert({ challenge_id: challengeId, user_id: userId, log_date: logDate }, { onConflict: 'challenge_id,user_id,log_date', ignoreDuplicates: false })
    .select().single()
  if (error) throw error
  return data
}

async function upsertEntry(dayLogId, req, userId, patch) {
  const now = new Date().toISOString()
  // Stamp logged_at the first time real proof lands, and never again: this is
  // what a deadline is measured against, and updated_at moves every time a
  // caption is edited or a macro estimate is written back.
  const isProof = patch.photo_path || patch.photo_paths?.length || patch.checked === true || patch.check_count > 0
    || (typeof patch.caption === 'string' && patch.caption.trim().length > 0)
  const row = {
    day_log_id: dayLogId, requirement_id: req.id, challenge_id: req.challengeId,
    user_id: userId, updated_at: now, ...patch,
  }
  const write = async (r) => supabase.from('log_entries')
    .upsert(r, { onConflict: 'day_log_id,requirement_id' }).select().single()

  let { data, error } = await write(isProof ? { logged_at: now, ...row } : row)
  // Pre-migration databases have no logged_at; everything else still works.
  if (error && /logged_at/.test(error.message || '')) ({ data, error } = await write(row))
  if (error) throw error
  return nEntry(data)
}

// Downscale to ~1600px JPEG before upload (strips EXIF as a side effect).
export async function resizeImage(file, maxDim = 1600, quality = 0.82) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
    bitmap.close?.()
    if (!blob) throw new Error('toBlob returned null')
    return blob
  } catch {
    return file
  }
}

export const MAX_PHOTOS_PER_ITEM = 4

export async function uploadProof(challengeId, userId, logDate, req, file, existing) {
  const blob = await resizeImage(file)
  // Multi-photo items get a unique suffix so shots stack instead of overwrite.
  const path = req.multi
    ? `${userId}/${challengeId}/${logDate}/${req.key}_${Date.now()}.jpg`
    : `${userId}/${challengeId}/${logDate}/${req.key}.jpg`
  const { error } = await supabase.storage.from('proof')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  const dl = await ensureDayLog(challengeId, userId, logDate)
  const paths = req.multi
    ? [...(existing?.photoPaths || []), path].slice(0, MAX_PHOTOS_PER_ITEM)
    : [path]
  // Every new photo resets the AI verdict — the re-review sees the full set.
  const patch = { photo_path: paths[0], photo_paths: paths, ai_flag: null, ai_note: null, ai_dismissed: false }
  let entry
  try {
    entry = await upsertEntry(dl.id, req, userId, patch)
  } catch (e) {
    // Pre-migration fallback: photo_paths column not there yet.
    if (!/photo_paths/.test(e.message || '')) throw e
    delete patch.photo_paths
    entry = await upsertEntry(dl.id, req, userId, patch)
  }
  requestAiReview(entry.id) // fire-and-forget spot check
  return entry
}

// Clear all photos on an item (start over). Entry fields only — the storage
// objects are unreferenced afterwards, which is fine.
export async function clearPhotos(challengeId, userId, logDate, req) {
  const dl = await ensureDayLog(challengeId, userId, logDate)
  const patch = { photo_path: null, photo_paths: [], ai_flag: null, ai_note: null, ai_dismissed: false }
  try {
    return await upsertEntry(dl.id, req, userId, patch)
  } catch (e) {
    if (!/photo_paths/.test(e.message || '')) throw e
    delete patch.photo_paths
    return upsertEntry(dl.id, req, userId, patch)
  }
}

export async function setChecked(challengeId, userId, logDate, req, checked) {
  const dl = await ensureDayLog(challengeId, userId, logDate)
  return upsertEntry(dl.id, req, userId, { checked })
}

// Multi-a-day check items: store today's tap count; `checked` mirrors whether
// the target is met so every reader of the boolean stays correct. Pre-migration
// (no check_count column) it degrades to the plain boolean.
export async function setCheckCount(challengeId, userId, logDate, req, count) {
  const dl = await ensureDayLog(challengeId, userId, logDate)
  const target = req.timesPerDay || 1
  try {
    return await upsertEntry(dl.id, req, userId, { check_count: count, checked: count >= target })
  } catch (e) {
    if (/check_count/.test(e?.message || '')) {
      return upsertEntry(dl.id, req, userId, { checked: count > 0 })
    }
    throw e
  }
}

export async function dismissAiFlag(entryId) {
  const { error } = await supabase.from('log_entries').update({ ai_dismissed: true }).eq('id', entryId)
  if (error) throw error
}

// Where the /api/* Netlify functions live:
//  • Native app (Capacitor): assets load from a local origin with no backend,
//    so call the deployed site absolutely.
//  • Dev preview: the Vite server has no /api routes — hit the deployed site.
//  • Web deploy: same-origin ('').
export const API_BASE = Capacitor.isNativePlatform()
  ? 'https://youmode.app'
  : (import.meta.env.DEV ? 'https://youmode-app.netlify.app' : '')

// Ad-hoc "extra meal" slots for body-goal users: a fixed pool of optional
// photo requirements (reused per day) so snacks/extras count toward macros
// without gating day completion. Idempotent.
export const EXTRA_MEAL_KEYS = ['extra_1', 'extra_2', 'extra_3', 'extra_4', 'extra_5', 'extra_6']
export async function ensureExtraMealSlots(challengeId, userId) {
  const { data: existing, error: ge } = await supabase.from('requirements')
    .select('key').eq('challenge_id', challengeId).eq('user_id', userId).like('key', 'extra\\_%')
  if (ge) return // best-effort
  const have = new Set((existing || []).map((r) => r.key))
  const missing = EXTRA_MEAL_KEYS.filter((k) => !have.has(k))
  if (!missing.length) return
  const rows = missing.map((k) => ({
    challenge_id: challengeId, user_id: userId, key: k, label: 'Extra Meal',
    hint: 'optional · counts toward your goal', group_label: 'Fuel', icon: 'camera',
    kind: 'photo', optional: true, multi: false, sort: 100 + Number(k.split('_')[1]),
  }))
  const { error } = await supabase.from('requirements').insert(rows)
  if (error && !/duplicate|unique/i.test(error.message || '')) throw error
}
export const isExtraMeal = (r) => (r.key || '').startsWith('extra_')

// ─── body goal: captions, estimates, weigh-ins ───────────────────────────
const planRow = (p) => ({
  goal_text: p.goalText, start_weight: p.startWeight,
  target_weight: p.targetWeight, target_date: p.targetDate,
  protein_min: p.proteinMin, protein_max: p.proteinMax,
  calorie_target: p.calorieTarget, rate_target: p.rateTarget,
  // Nutrition prefs ride along; all null for a pure weight goal, and the
  // weight fields are all null for someone who only wants meal numbers.
  nutrition_mode: p.mode || p.nutritionMode || null,
  fiber_target: p.fiberTarget ?? null, sat_fat_max: p.satFatMax ?? null,
  sodium_max: p.sodiumMax ?? null, sugar_max: p.sugarMax ?? null,
})

// Goals are additive — a member can stack several.
export async function createBodyPlan(userId, p) {
  const { error } = await supabase.from('body_plans').insert({ user_id: userId, ...planRow(p) })
  if (error) throw error
}

export async function updateBodyPlan(planId, p) {
  const { error } = await supabase.from('body_plans').update(planRow(p)).eq('id', planId)
  if (error) throw error
}

export async function deleteBodyPlan(planId) {
  const { error } = await supabase.from('body_plans').delete().eq('id', planId)
  if (error) throw error
}

export async function coachChat(messages, labNote = null) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(`${API_BASE}/api/goal-coach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages, labNote }),
  })
  if (!res.ok) throw new Error('coach unavailable')
  return res.json() // { reply, proposal }
}

// Talk-to-build onboarding: the same short-conversation transport as coachChat,
// but the proposal it returns is a whole challenge (name, dayCount, checklist,
// format) the user reviews and creates.
export async function onboardChat(messages) {
  // A tab that slept for hours wakes with an expired token; refresh and retry
  // instead of surfacing "couldn't reach" for something we can heal ourselves.
  const call = (token) => fetch(`${API_BASE}/api/onboard-coach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  })
  let token = (await supabase.auth.getSession()).data?.session?.access_token
  if (!token) {
    token = (await supabase.auth.refreshSession()).data?.session?.access_token
    if (!token) throw new Error('not signed in')
  }
  let res = await call(token)
  if (res.status === 401) {
    const fresh = (await supabase.auth.refreshSession()).data?.session?.access_token
    if (fresh) res = await call(fresh)
  }
  if (!res.ok) throw new Error('coach unavailable')
  return res.json() // { reply, proposal }
}

// Speech-to-text for the voice ramble: base64 audio + its mime type in, plain
// transcript out. The caller records with MediaRecorder and edits the result
// before sending it to the coach.
export async function transcribeAudio(audio, mimeType) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ audio, mimeType }),
  })
  // Surface the server's reason when it has one. "Transcription failed" after
  // ten minutes of talking tells someone nothing about what to do next.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'transcription failed')
  }
  return res.json() // { text }
}

// A note IS the proof for a note item, so it goes through the entry upsert
// (which stamps logged_at) rather than the caption patch, which exists to
// re-describe a meal photo.
export async function saveNote(challengeId, userId, logDate, req, text) {
  const dl = await ensureDayLog(challengeId, userId, logDate)
  return upsertEntry(dl.id, req, userId, { caption: (text || '').trim() || null })
}

export async function saveCaption(entryId, caption) {
  // Clear the stale macro estimate as we save the new caption, so the tile
  // reads "estimating…" until the caller re-scores it (see estimateMeal).
  // Without this, an edited caption keeps its old protein/calorie numbers.
  const { error } = await supabase.from('log_entries')
    .update({ caption: caption?.trim() || null, est_protein: null, est_calories: null, updated_at: new Date().toISOString() })
    .eq('id', entryId)
  if (error) throw error
}

// Backfill a meal by description on ANY day (no photo needed) — for logging a
// meal you didn't get to enter until later (a late dinner past midnight).
// Ensures the day + entry exist, sets the caption, clears the stale estimate,
// and returns the entry so the caller can re-score it. RLS is ownership-only,
// so past days are writable; only the client's day-lock forbids it on Today.
export async function logMealCaption(challengeId, userId, logDate, req, caption) {
  const dl = await ensureDayLog(challengeId, userId, logDate)
  return upsertEntry(dl.id, req, userId, {
    caption: caption?.trim() || null, est_protein: null, est_calories: null,
  })
}

export async function addWeighIn(userId, date, weight) {
  const { error } = await supabase.from('weigh_ins')
    .upsert({ user_id: userId, weigh_date: date, weight }, { onConflict: 'user_id,weigh_date' })
  if (error) throw error
}

// Awaitable estimate — used to self-heal entries stranded on "estimating…"
// after a prior fire-and-forget request silently failed (cold function,
// dropped mobile connection, etc.).
// Read a sleep screenshot and score it against the item's targets. Same
// fire-and-forget shape as the meal estimate: the photo is already saved, this
// only adds the reading.
export async function verifySleep(entryId) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(`${API_BASE}/api/verify-sleep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entryId }),
  })
  if (!res.ok) throw new Error('sleep check failed')
  return res.json()
}

export async function estimateMeal(entryId) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(`${API_BASE}/api/estimate-meal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entryId }),
  })
  if (!res.ok) throw new Error('estimate failed')
  return res.json()
}

// ─── AI spot check (Netlify function; never blocks the upload) ───────────
async function requestAiReview(entryId) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return
    fetch(`${API_BASE}/api/review-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entryId }),
    }).catch(() => {})
  } catch { /* best-effort only */ }
}

// ─── one-time redemption ("your one save") ───────────────────────────────
// Spends the member's single save on a date. The once-only guard lives in the
// SQL function, so a second attempt fails server-side even if the UI slips.
export async function useRedemption(memberId, date) {
  const { data, error } = await supabase.rpc('use_redemption', { p_member_id: memberId, p_date: date })
  if (error) {
    // Pre-migration the function doesn't exist yet: say so plainly instead of
    // leaking a Postgres error at someone who just missed a day.
    if (/could not find|does not exist|schema cache/i.test(error.message || '')) {
      throw new Error("Saves aren't switched on yet. Try again once the update lands.")
    }
    throw new Error(error.message || "Couldn't use your save.")
  }
  return nMember(data)
}

// ─── blood work ──────────────────────────────────────────────────────────
// The uploaded document is never persisted: extract-labs reads it in flight
// and only the markers the member confirms are stored (supabase/lab-results.sql).
export async function extractLabs(fileBase64, mime, today) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again to upload results.')
  const res = await fetch(`${API_BASE}/api/extract-labs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fileBase64, mime, today }),
  })
  // Heartbeat-streamed: leading newlines are legal JSON whitespace, so this
  // parses unchanged. Errors arrive in the body rather than the status.
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) throw new Error(body.error || 'Could not read that file.')
  return body
}

export async function saveLabResult(userId, { drawnOn, panelName, markers }) {
  const { data, error } = await supabase.from('lab_results')
    .upsert({ user_id: userId, drawn_on: drawnOn, panel_name: panelName || null, markers },
      { onConflict: 'user_id,drawn_on' })
    .select().single()
  if (error) throw error
  return nLab(data)
}

export async function listLabResults(userId) {
  const { data, error } = await supabase.from('lab_results')
    .select('*').eq('user_id', userId).order('drawn_on', { ascending: false })
  if (error) return [] // table not migrated yet: the rest of Goals still works
  return (data || []).map(nLab)
}

export async function deleteLabResult(id) {
  const { error } = await supabase.from('lab_results').delete().eq('id', id)
  if (error) throw error
}

// ─── referee verdict ──────────────────────────────────────────────────────
export async function reviewDay(dayLogId, verdict, note) {
  const { error } = await supabase.rpc('review_day2', { p_log_id: dayLogId, p_verdict: verdict, p_note: note || null })
  if (error) throw error
}

// ─── signed URLs ──────────────────────────────────────────────────────────
const urlCache = new Map()
export async function signedUrl(path) {
  if (!path) return null
  const hit = urlCache.get(path)
  if (hit && hit.exp > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from('proof').createSignedUrl(path, 3600)
  if (error) return null
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3000 * 1000 })
  return data.signedUrl
}

// ─── realtime ────────────────────────────────────────────────────────────
export function subscribe(challengeId, onChange) {
  const channel = supabase
    .channel(`ch-${challengeId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'day_logs', filter: `challenge_id=eq.${challengeId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'log_entries', filter: `challenge_id=eq.${challengeId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `challenge_id=eq.${challengeId}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
