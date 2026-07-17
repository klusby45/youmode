// Verifies the deployed /api/transcribe end to end with a real speech clip
// (synthesized via macOS `say`, encoded as m4a/aac like iOS Safari produces).
// Mints a disposable user for the JWT, asserts a plausible transcript, cleans up.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REF = 'aqaubrbssnbtomykexgr', DOMAIN = '75hard.app', BASE = `https://${REF}.supabase.co`
const URL = 'https://youmode.app/api/transcribe'
const AUDIO = process.argv[2] || '/tmp/onbtest.m4a'
const MIME = process.argv[3] || 'audio/mp4'

let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key
const ANON = readFileSync('src/supabaseClient.js', 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0]
const admin = createClient(BASE, SERVICE, { auth: { persistSession: false } })

const run = async () => {
  const email = `zztrans@${DOMAIN}`
  let page = 1, id = null
  for (;;) { const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 }); for (const u of data.users) if (u.email === email) id = u.id; if (data.users.length < 200) break; page++ }
  if (id) await admin.auth.admin.deleteUser(id)
  id = (await admin.auth.admin.createUser({ email, password: 'transpass1', email_confirm: true })).data.user.id

  const anon = createClient(BASE, ANON, { auth: { persistSession: false } })
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: 'transpass1' })
  const token = sess.session.access_token

  const b64 = readFileSync(AUDIO).toString('base64')
  const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ audio: b64, mimeType: MIME }) })
  const status = r.status
  const body = await r.json().catch(() => ({}))
  await admin.auth.admin.deleteUser(id)

  console.log('status', status)
  if (body.upstreamStatus || body.code) console.log('upstream:', body.upstreamStatus, body.code)
  console.log('transcript:', JSON.stringify(body.text || body.error || body))
  const text = (body.text || '').toLowerCase()
  const ok = status === 200 && /marathon/.test(text) && /read/.test(text)
  console.log(ok ? '\n✓ TRANSCRIBE E2E PASSED — cleaned up' : '\n✗ transcription did not match expected words')
  process.exit(ok ? 0 : 1)
}
run().catch((e) => { console.error(e); process.exit(1) })
