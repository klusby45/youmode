// ─────────────────────────────────────────────────────────────────────────
// youmode-e2e.mjs — disposable users + challenges to verify the You Mode
// release (community leaderboard, format picker, privacy gate). The service
// key is fetched at runtime and never printed.
//
//   node scripts/youmode-e2e.mjs setup     # create test users + community challenge
//   node scripts/youmode-e2e.mjs migrated  # report whether the SQL paste has landed
//   node scripts/youmode-e2e.mjs cleanup    # delete everything this script made
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

const REF = 'aqaubrbssnbtomykexgr'
const URL = `https://${REF}.supabase.co`
const DOMAIN = '75hard.app'

let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) {
  try {
    const out = execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    SERVICE = JSON.parse(out).find((k) => k.name === 'service_role').api_key
  } catch {
    try {
      const out = execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      SERVICE = out.split('\n').find((l) => /service_role/.test(l)).trim().split(/\s+/).pop()
    } catch { /* fall through */ }
  }
}
if (!SERVICE) { console.error('No service key (set SUPABASE_SERVICE_KEY or auth the supabase CLI)'); process.exit(1) }

const sb = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

// disposable roster — "zz" prefix keeps them out of the way and easy to purge
const TEST = [
  { u: 'zzcomma', name: 'Ava' },
  { u: 'zzcommb', name: 'Ben' },
  { u: 'zzcommc', name: 'Cy' },
]
const ACCENTS = ['#FF3B30', '#34C759', '#0A84FF', '#FF9F0A']
const REQS = [
  { key: 'workout', label: 'Workout', kind: 'photo', icon: 'run' },
  { key: 'water', label: 'Water', kind: 'check', icon: 'drop' },
  { key: 'read', label: 'Read', kind: 'check', icon: 'book' },
]

async function findUsers() {
  const map = {}
  let page = 1
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const usr of data.users) map[usr.email] = usr.id
    if (data.users.length < 200) break
    page++
  }
  return map
}

async function migrated() {
  const cols = {}
  const probe = async (table, col) => {
    const { error } = await sb.from(table).select(col).limit(1)
    cols[`${table}.${col}`] = !error
  }
  await probe('profiles', 'tone')
  await probe('profiles', 'photo_sharing')
  await probe('requirements', 'is_private')
  await probe('challenges', 'format')
  console.log(JSON.stringify(cols, null, 2))
  console.log(Object.values(cols).every(Boolean) ? '✓ migration applied' : '✗ migration NOT applied yet')
}

async function setup() {
  const existing = await findUsers()
  const ids = []
  for (const p of TEST) {
    const email = `${p.u}@${DOMAIN}`
    let id = existing[email]
    if (!id) {
      const { data, error } = await sb.auth.admin.createUser({ email, password: p.u, email_confirm: true })
      if (error) { console.error(`create ${p.u}: ${error.message}`); process.exit(1) }
      id = data.user.id
    }
    await sb.from('profiles').upsert({ id, username: p.u, display_name: p.name, phone: '', role: 'participant' })
    ids.push(id)
    console.log(`user ${p.u} / ${p.u}  (${p.name})`)
  }

  // one community challenge owned by the first user; format left null so the
  // app derives 'community' from 3 participants (works pre-migration too).
  const owner = ids[0]
  let { data: ch } = await sb.from('challenges')
    .insert({ name: 'Test Community', join_code: 'ZZCOMM', owner_id: owner, start_date: '2026-07-01', timezone: 'America/Los_Angeles' })
    .select().single()
  if (!ch) { const r = await sb.from('challenges').select('*').eq('join_code', 'ZZCOMM').single(); ch = r.data }

  for (let i = 0; i < ids.length; i++) {
    await sb.from('members').upsert({ challenge_id: ch.id, user_id: ids[i], role: 'participant', accent: ACCENTS[i % 4] }, { onConflict: 'challenge_id,user_id' })
    for (let j = 0; j < REQS.length; j++) {
      const r = REQS[j]
      await sb.from('requirements').upsert(
        { challenge_id: ch.id, user_id: ids[i], key: r.key, label: r.label, kind: r.kind, icon: r.icon, sort: j + 1 },
        { onConflict: 'challenge_id,user_id,key' },
      ).select()
    }
  }
  console.log(`\ncommunity challenge ZZCOMM ready with ${ids.length} participants`)
  console.log('log into preview as  zzcomma / zzcomma  → Standings shows the leaderboard')
}

async function cleanup() {
  const existing = await findUsers()
  const { data: ch } = await sb.from('challenges').select('id').eq('join_code', 'ZZCOMM').maybeSingle()
  if (ch) {
    await sb.from('log_entries').delete().eq('challenge_id', ch.id)
    await sb.from('day_logs').delete().eq('challenge_id', ch.id)
    await sb.from('requirements').delete().eq('challenge_id', ch.id)
    await sb.from('members').delete().eq('challenge_id', ch.id)
    await sb.from('challenges').delete().eq('id', ch.id)
  }
  for (const p of TEST) {
    const id = existing[`${p.u}@${DOMAIN}`]
    if (id) { await sb.from('profiles').delete().eq('id', id); await sb.auth.admin.deleteUser(id) }
  }
  console.log('cleaned up test users + ZZCOMM challenge')
}

// Privacy override test: owner shares 'all' but locks one photo item. A
// challenge-mate viewing the owner's day should see the shared photo but only
// an icon tile for the locked one. Pure disposable data (zzpriv*).
const PRIV = [{ u: 'zzprivo', name: 'Odin' }, { u: 'zzprivv', name: 'Vera' }]
async function privtest() {
  const existing = await findUsers()
  const ids = {}
  for (const p of PRIV) {
    const email = `${p.u}@${DOMAIN}`
    let id = existing[email]
    if (!id) {
      const { data, error } = await sb.auth.admin.createUser({ email, password: p.u, email_confirm: true })
      if (error) { console.error(`create ${p.u}: ${error.message}`); process.exit(1) }
      id = data.user.id
    }
    await sb.from('profiles').upsert({ id, username: p.u, display_name: p.name, phone: '', role: 'participant', photo_sharing: p.u === 'zzprivo' ? 'all' : null })
    ids[p.u] = id
  }
  const owner = ids.zzprivo, viewer = ids.zzprivv
  let { data: ch } = await sb.from('challenges').insert({ name: 'Priv Test', join_code: 'ZZPRIV', owner_id: owner, start_date: '2026-07-01', timezone: 'America/Los_Angeles' }).select().single()
  if (!ch) { const r = await sb.from('challenges').select('*').eq('join_code', 'ZZPRIV').single(); ch = r.data }
  for (const uid of [owner, viewer]) await sb.from('members').upsert({ challenge_id: ch.id, user_id: uid, role: 'participant', accent: '#FF3B30' }, { onConflict: 'challenge_id,user_id' })
  // owner's two photo reqs: one shared, one locked
  const reqDefs = [{ key: 'shared_pic', label: 'Shared Pic', is_private: false }, { key: 'secret_pic', label: 'Secret Pic', is_private: true }]
  const reqIds = {}
  for (let i = 0; i < reqDefs.length; i++) {
    const r = reqDefs[i]
    const { data } = await sb.from('requirements').upsert(
      { challenge_id: ch.id, user_id: owner, key: r.key, label: r.label, kind: 'photo', icon: 'camera', sort: i + 1, is_private: r.is_private },
      { onConflict: 'challenge_id,user_id,key' }).select('id').single()
    reqIds[r.key] = data.id
  }
  // a logged day with a (fake-path) photo on each req so both render
  const { data: dl } = await sb.from('day_logs').upsert({ challenge_id: ch.id, user_id: owner, log_date: '2026-07-10', status: 'pending' }, { onConflict: 'challenge_id,user_id,log_date' }).select('id').single()
  for (const key of ['shared_pic', 'secret_pic']) {
    await sb.from('log_entries').upsert({ day_log_id: dl.id, requirement_id: reqIds[key], challenge_id: ch.id, user_id: owner, photo_path: `${owner}/${ch.id}/2026-07-10/${key}.jpg` }, { onConflict: 'day_log_id,requirement_id' })
  }
  console.log('privtest ready. log into preview as  zzprivv / zzprivv  → Standings → Odin → See proof')
  console.log('EXPECT: "Shared Pic" shows a photo tile, "Secret Pic" shows an icon-only private tile')
}
async function privcleanup() {
  const existing = await findUsers()
  const { data: ch } = await sb.from('challenges').select('id').eq('join_code', 'ZZPRIV').maybeSingle()
  if (ch) {
    await sb.from('log_entries').delete().eq('challenge_id', ch.id)
    await sb.from('day_logs').delete().eq('challenge_id', ch.id)
    await sb.from('requirements').delete().eq('challenge_id', ch.id)
    await sb.from('members').delete().eq('challenge_id', ch.id)
    await sb.from('challenges').delete().eq('id', ch.id)
  }
  for (const p of PRIV) { const id = existing[`${p.u}@${DOMAIN}`]; if (id) { await sb.from('profiles').delete().eq('id', id); await sb.auth.admin.deleteUser(id) } }
  console.log('cleaned up privtest users + ZZPRIV challenge')
}

const cmd = process.argv[2]
const fn = { setup, cleanup, migrated, privtest, privcleanup }[cmd]
if (!fn) { console.error('usage: node scripts/youmode-e2e.mjs setup|migrated|cleanup|privtest|privcleanup'); process.exit(1) }
fn().catch((e) => { console.error(e); process.exit(1) })
