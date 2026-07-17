// Regression for the long-ramble truncation bug: the coach used to slice each
// message to 1200 chars, so details late in a long voice transcript were
// silently dropped. This sends a ~3.5K-char ramble whose decisive details
// (exactly 43 days, "no photos, checks only") appear ONLY at the very end,
// and asserts the proposal honors them. Disposable user, cleaned up.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REF = 'aqaubrbssnbtomykexgr', DOMAIN = '75hard.app', BASE = `https://${REF}.supabase.co`
const COACH = 'https://youmode.app/api/onboard-coach'

let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key
const ANON = readFileSync('src/supabaseClient.js', 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0]
const admin = createClient(BASE, SERVICE, { auth: { persistSession: false } })

let pass = true
const check = (n, ok, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'}  ${n}${extra ? '  — ' + extra : ''}`); if (!ok) pass = false; return ok }

// ~3.4K chars of realistic filler ramble BEFORE any decisive detail.
const filler = [
  "Okay so, where do I even start. I had my second kid about eight months ago and honestly I just have not felt like myself since.",
  'Before my first pregnancy I was pretty active, I did spin classes like three times a week and I ate pretty well, I meal prepped on Sundays, the whole thing.',
  'And now I basically live in leggings and I am tired all the time and I snack constantly because the baby is up at weird hours and my sleep is a mess.',
  'My sister keeps telling me I need some structure and she is probably right, she did one of these challenge things last year and it really worked for her.',
  'I do not want anything insane though, like I saw those 75 Hard videos and two workouts a day is just not happening with a baby and a toddler in the house.',
  'Realistically I can do one workout a day, and honestly some days that workout might just be a long stroller walk around the neighborhood and that has to count.',
  'I also want to get my eating back under control, not a diet exactly, more like actually cooking real food instead of eating handfuls of crackers over the sink.',
  'And water, I basically live on coffee right now, I probably drink one glass of actual water a day which I know is terrible.',
  'Sleep is the other thing, I doom scroll in bed every single night for like an hour and then I am mad at myself in the morning.',
  'So maybe something about putting the phone away and reading instead, my friend gave me a stack of books when I was pregnant and I have not opened a single one.',
  'I also journaled for a while after my first was born and it genuinely helped my head, so maybe a line or two a day, nothing fancy.',
].join(' ')

// The decisive details live AFTER all of that — past the old 1200-char cut.
const tail = ' Oh and two specific things, I know exactly what I want here. First, I want it to be exactly 43 days because that lands right on my birthday. Second, I do not want to take any photos of anything, please make every single item a simple checkmark, no photo proof at all. Just me, solo.'
const RAMBLE = filler + tail

const run = async () => {
  console.log(`ramble length: ${RAMBLE.length} chars (details start at ~${filler.length})`)
  const email = `zzramble@${DOMAIN}`
  let page = 1, id = null
  for (;;) { const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 }); for (const u of data.users) if (u.email === email) id = u.id; if (data.users.length < 200) break; page++ }
  if (id) await admin.auth.admin.deleteUser(id)
  id = (await admin.auth.admin.createUser({ email, password: 'ramblepass1', email_confirm: true })).data.user.id

  const anon = createClient(BASE, ANON, { auth: { persistSession: false } })
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: 'ramblepass1' })
  const token = sess.session.access_token

  const msgs = [{ role: 'user', content: RAMBLE }]
  let proposal = null, lastReply = ''
  for (let turn = 0; turn < 3 && !proposal; turn++) {
    const r = await fetch(COACH, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: msgs }) })
    const body = await r.json().catch(() => ({}))
    if (!check(`coach responds 200 (turn ${turn + 1})`, r.status === 200, String(r.status))) break
    lastReply = body.reply || ''
    if (body.proposal) { proposal = body.proposal; break }
    msgs.push({ role: 'assistant', content: body.reply || '…' })
    msgs.push({ role: 'user', content: 'That covers it, go ahead and build it exactly like I said.' })
  }
  if (!check('coach produced a proposal', !!proposal, lastReply.slice(0, 100))) { await admin.auth.admin.deleteUser(id); return finish() }

  console.log('\n  proposal:', JSON.stringify({ name: proposal.name, format: proposal.format, dayCount: proposal.dayCount, kinds: proposal.items.map((i) => i.kind) }))
  check('honored 43 days (detail past old 1200-char cut)', proposal.dayCount === 43, String(proposal.dayCount))
  check('honored no-photos (every item a check)', proposal.items.length > 0 && proposal.items.every((i) => i.kind === 'check'), proposal.items.map((i) => i.kind).join(','))
  check('honored solo', proposal.format === 'solo', proposal.format)

  await admin.auth.admin.deleteUser(id)
  finish()
}
const finish = () => { console.log(pass ? '\n✓ LONG-RAMBLE REGRESSION PASSED — cleaned up' : '\n✗ FAILURES ABOVE'); process.exit(pass ? 0 : 1) }
run().catch((e) => { console.error(e); process.exit(1) })
