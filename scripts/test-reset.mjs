// E2E for the password-reset security core (no email needed — mints the token
// server-side with the same HMAC secret the function uses). Creates a
// disposable user, resets the password via the live endpoint, and proves the
// new password works + the old one doesn't. Also checks token guards.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'

const REF = 'aqaubrbssnbtomykexgr', DOMAIN = '75hard.app', BASE = `https://${REF}.supabase.co`
const RESET = 'https://youmode.app/api/reset-password'
let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key
const ANON = readFileSync('src/supabaseClient.js', 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0]
const admin = createClient(BASE, SERVICE, { auth: { persistSession: false } })
const check = (n, p) => { console.log(`${p ? '✓' : '✗ FAIL'}  ${n}`); return p }

const mint = (uid, exp = Date.now() + 15 * 60 * 1000) => {
  const payload = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url')
  const sig = createHmac('sha256', SERVICE).update(payload).digest('base64url')
  return `${payload}.${sig}`
}
const post = async (token, password) => {
  const r = await fetch(RESET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
const canSignIn = async (email, password) => {
  const c = createClient(BASE, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  return !error && !!data.session
}

const run = async () => {
  const email = `zzreset@${DOMAIN}`
  let page = 1, id = null
  for (;;) { const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 }); for (const u of data.users) if (u.email === email) id = u.id; if (data.users.length < 200) break; page++ }
  if (id) await admin.auth.admin.deleteUser(id)
  id = (await admin.auth.admin.createUser({ email, password: 'oldpass123', email_confirm: true })).data.user.id
  let ok = true

  ok &= check('valid token resets password', (await post(mint(id), 'newpass456')).body.ok === true)
  ok &= check('new password works', await canSignIn(email, 'newpass456'))
  ok &= check('old password rejected', !(await canSignIn(email, 'oldpass123')))
  ok &= check('expired token rejected (400)', (await post(mint(id, Date.now() - 1000), 'hackpass1')).status === 400)
  ok &= check('tampered signature rejected (400)', (await post(mint(id).slice(0, -3) + 'xxx', 'hackpass1')).status === 400)
  ok &= check('short password rejected (400)', (await post(mint(id), '123')).status === 400)
  ok &= check('password unchanged after rejected attempts', await canSignIn(email, 'newpass456'))

  await admin.auth.admin.deleteUser(id)
  console.log(ok ? '\n✓ RESET SECURITY CORE VERIFIED — cleaned up' : '\n✗ FAILURES ABOVE')
  process.exit(ok ? 0 : 1)
}
run().catch((e) => { console.error(e); process.exit(1) })
