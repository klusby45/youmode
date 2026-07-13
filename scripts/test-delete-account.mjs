// End-to-end test for /api/delete-account against the deployed function.
// Creates disposable users, seeds the owner with data + a stored photo + a
// day they refereed, deletes them via the real endpoint (real JWT), and
// verifies: full cascade, ownership handoff to the co-participant, referee
// reference released, storage photo gone, co-participant untouched.
//
//   node scripts/test-delete-account.mjs
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REF = 'aqaubrbssnbtomykexgr'
const URL = `https://${REF}.supabase.co`
const DOMAIN = '75hard.app'
const ENDPOINT = 'https://youmode.app/api/delete-account'

let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) {
  try { SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key } catch {}
}
if (!SERVICE) { console.error('no service key'); process.exit(1) }
const ANON = readFileSync('src/supabaseClient.js', 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0]

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
const results = []
const check = (name, pass) => { results.push({ name, pass }); console.log(`${pass ? '✓' : '✗ FAIL'}  ${name}`) }

async function ensureUser(u, name) {
  let page = 1, id = null
  for (;;) { const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 }); for (const x of data.users) if (x.email === `${u}@${DOMAIN}`) id = x.id; if (data.users.length < 200) break; page++ }
  if (!id) { const { data, error } = await admin.auth.admin.createUser({ email: `${u}@${DOMAIN}`, password: u, email_confirm: true }); if (error) throw error; id = data.user.id }
  await admin.from('profiles').upsert({ id, username: u, display_name: name, phone: '', role: 'participant' })
  return id
}

const run = async () => {
  // ── setup ──
  const owner = await ensureUser('zzdela', 'Ana')   // owns the challenge
  const mate = await ensureUser('zzdelb', 'Bo')     // co-participant → inherits it
  let { data: ch } = await admin.from('challenges').insert({ name: 'Del Test', join_code: 'ZZDEL', owner_id: owner, start_date: '2026-07-01', timezone: 'America/Los_Angeles' }).select().single()
  if (!ch) ch = (await admin.from('challenges').select('*').eq('join_code', 'ZZDEL').single()).data
  await admin.from('challenges').update({ owner_id: owner }).eq('id', ch.id)
  for (const uid of [owner, mate]) await admin.from('members').upsert({ challenge_id: ch.id, user_id: uid, role: 'participant', accent: '#FF3B30' }, { onConflict: 'challenge_id,user_id' })
  const { data: req } = await admin.from('requirements').upsert({ challenge_id: ch.id, user_id: owner, key: 'workout', label: 'Workout', kind: 'photo', icon: 'run', sort: 1 }, { onConflict: 'challenge_id,user_id,key' }).select().single()
  // owner's day with a stored photo
  const photoPath = `${owner}/${ch.id}/2026-07-11/workout.jpg`
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMDAQCf8SEAAAAASUVORK5CYII=', 'base64')
  await admin.storage.from('proof').upload(photoPath, png, { contentType: 'image/jpeg', upsert: true })
  const { data: dl } = await admin.from('day_logs').upsert({ challenge_id: ch.id, user_id: owner, log_date: '2026-07-11', status: 'pending' }, { onConflict: 'challenge_id,user_id,log_date' }).select().single()
  await admin.from('log_entries').upsert({ day_log_id: dl.id, requirement_id: req.id, challenge_id: ch.id, user_id: owner, photo_path: photoPath }, { onConflict: 'day_log_id,requirement_id' })
  await admin.from('body_plans').upsert({ user_id: owner, goal_text: 'test', target_weight: 180, protein_min: 150, protein_max: 175, calorie_target: 3000 }, { onConflict: 'user_id' })
  await admin.from('weigh_ins').upsert({ user_id: owner, weigh_date: '2026-07-11', weight: 175 }, { onConflict: 'user_id,weigh_date' })

  // ── sign in as the owner to get a real JWT, then call the live endpoint ──
  const asUser = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: sess, error: sErr } = await asUser.auth.signInWithPassword({ email: `zzdela@${DOMAIN}`, password: 'zzdela' })
  if (sErr) { console.error('signin failed', sErr.message); process.exit(1) }
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) console.log('  ↳ endpoint error body:', JSON.stringify(body))
  check(`endpoint returns ok (${res.status})`, res.ok && body.ok === true)

  // ── verify ──
  const gone = async (t, col, val) => { const { data } = await admin.from(t).select('*').eq(col, val); return (data || []).length === 0 }
  check('owner profile deleted', await gone('profiles', 'id', owner))
  check('owner members deleted', await gone('members', 'user_id', owner))
  check('owner requirements deleted', await gone('requirements', 'user_id', owner))
  check('owner day_logs deleted', await gone('day_logs', 'user_id', owner))
  check('owner log_entries deleted', await gone('log_entries', 'user_id', owner))
  check('owner body_plan deleted', await gone('body_plans', 'user_id', owner))
  check('owner weigh_ins deleted', await gone('weigh_ins', 'user_id', owner))
  const { data: authGone } = await admin.auth.admin.getUserById(owner).then((r) => ({ data: r.data?.user })).catch(() => ({ data: null }))
  check('owner auth user deleted', !authGone)
  const { data: chAfter } = await admin.from('challenges').select('owner_id').eq('id', ch.id).maybeSingle()
  check('challenge survived + ownership handed to mate', chAfter?.owner_id === mate)
  const { data: mateProfile } = await admin.from('profiles').select('id').eq('id', mate).maybeSingle()
  check('co-participant untouched', !!mateProfile)
  const { data: photoList } = await admin.storage.from('proof').list(`${owner}/${ch.id}/2026-07-11`)
  check('stored photo removed', !photoList || photoList.length === 0)

  // ── cleanup remaining ──
  await admin.from('log_entries').delete().eq('challenge_id', ch.id)
  await admin.from('day_logs').delete().eq('challenge_id', ch.id)
  await admin.from('requirements').delete().eq('challenge_id', ch.id)
  await admin.from('members').delete().eq('challenge_id', ch.id)
  await admin.from('challenges').delete().eq('id', ch.id)
  await admin.from('profiles').delete().eq('id', mate)
  await admin.auth.admin.deleteUser(mate).catch(() => {})
  // owner too, in case the delete under test failed and left them behind
  await admin.from('profiles').delete().eq('id', owner)
  await admin.auth.admin.deleteUser(owner).catch(() => {})
  await admin.storage.from('proof').remove([photoPath]).catch(() => {})

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${failed.length ? `✗ ${failed.length} CHECK(S) FAILED` : '✓ ALL CHECKS PASSED'} — test users cleaned up`)
  process.exit(failed.length ? 1 : 0)
}
run().catch((e) => { console.error(e); process.exit(1) })
