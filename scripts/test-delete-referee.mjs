// Confirms a REFEREE can now delete their account (needs the reviewed_by
// ON DELETE SET NULL migration). Deletes a referee who ruled a day; the day
// must survive with its reviewer pointer nulled.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REF = 'aqaubrbssnbtomykexgr', DOMAIN = '75hard.app', BASE = `https://${REF}.supabase.co`
let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key
const ANON = readFileSync('src/supabaseClient.js', 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0]
const admin = createClient(BASE, SERVICE, { auth: { persistSession: false } })
const check = (n, p) => { console.log(`${p ? '✓' : '✗ FAIL'}  ${n}`); return p }

const mkUser = async (u, name, role) => {
  let page = 1, id = null
  for (;;) { const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 }); for (const x of data.users) if (x.email === `${u}@${DOMAIN}`) id = x.id; if (data.users.length < 200) break; page++ }
  if (!id) id = (await admin.auth.admin.createUser({ email: `${u}@${DOMAIN}`, password: u, email_confirm: true })).data.user.id
  await admin.from('profiles').upsert({ id, username: u, display_name: name, phone: '', role })
  return id
}

const run = async () => {
  const par = await mkUser('zzpar', 'Pat', 'participant')  // owns the challenge, is judged
  const ref = await mkUser('zzref', 'Ref', 'participant')  // the referee, to be deleted
  let { data: ch } = await admin.from('challenges').insert({ name: 'Ref Test', join_code: 'ZZREF', owner_id: par, start_date: '2026-07-01', timezone: 'America/Los_Angeles' }).select().single()
  if (!ch) ch = (await admin.from('challenges').select('*').eq('join_code', 'ZZREF').single()).data
  await admin.from('challenges').update({ owner_id: par }).eq('id', ch.id)
  await admin.from('members').upsert({ challenge_id: ch.id, user_id: par, role: 'participant', accent: '#FF3B30' }, { onConflict: 'challenge_id,user_id' })
  await admin.from('members').upsert({ challenge_id: ch.id, user_id: ref, role: 'referee', accent: '#FFD60A' }, { onConflict: 'challenge_id,user_id' })
  // a day the referee ruled (insert with reviewed_by set — bypasses the update-guard trigger)
  const { data: dl } = await admin.from('day_logs').upsert({ challenge_id: ch.id, user_id: par, log_date: '2026-07-10', status: 'approved', reviewed_by: ref }, { onConflict: 'challenge_id,user_id,log_date' }).select().single()

  const asUser = createClient(BASE, ANON, { auth: { persistSession: false } })
  const { data: sess } = await asUser.auth.signInWithPassword({ email: `zzref@${DOMAIN}`, password: 'zzref' })
  const res = await fetch('https://youmode.app/api/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${sess.session.access_token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) console.log('  ↳ error:', JSON.stringify(body))

  let ok = true
  ok &= check(`referee deletion returns ok (${res.status})`, res.ok)
  const { data: refGone } = await admin.from('profiles').select('id').eq('id', ref).maybeSingle()
  ok &= check('referee profile deleted', !refGone)
  const { data: dlAfter } = await admin.from('day_logs').select('reviewed_by, status').eq('id', dl.id).maybeSingle()
  ok &= check('ruled day survived with reviewer nulled', dlAfter && dlAfter.reviewed_by === null && dlAfter.status === 'approved')
  const { data: parAlive } = await admin.from('profiles').select('id').eq('id', par).maybeSingle()
  ok &= check('judged participant untouched', !!parAlive)

  // cleanup
  await admin.from('log_entries').delete().eq('challenge_id', ch.id)
  await admin.from('day_logs').delete().eq('challenge_id', ch.id)
  await admin.from('requirements').delete().eq('challenge_id', ch.id)
  await admin.from('members').delete().eq('challenge_id', ch.id)
  await admin.from('challenges').delete().eq('id', ch.id)
  await admin.from('profiles').delete().eq('id', par); await admin.auth.admin.deleteUser(par).catch(() => {})
  await admin.from('profiles').delete().eq('id', ref); await admin.auth.admin.deleteUser(ref).catch(() => {})
  console.log(ok ? '\n✓ REFEREE DELETION WORKS — cleaned up' : '\n✗ still blocked')
  process.exit(ok ? 0 : 1)
}
run().catch((e) => { console.error(e); process.exit(1) })
