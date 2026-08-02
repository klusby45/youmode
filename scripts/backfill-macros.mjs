// ─────────────────────────────────────────────────────────────────────────
// backfill-macros.mjs — re-run the meal estimator over existing entries so
// historical days carry the full macro set, not just protein + calories.
//
//   node scripts/backfill-macros.mjs <username> [--dry] [--limit N] [--force]
//
// Picks up any meal entry with a photo or a caption that is still missing
// est_sat_fat. Photo-only entries are included on purpose: estimate-meal is
// multimodal and signs up to four proof photos into the request, so a meal
// logged without a description still gets estimated from the image.
//
// Serial, not parallel: this hits a rate-limited model endpoint on someone's
// real account, and a backfill finishing two minutes sooner is worth nothing
// next to tripping a 429 halfway through.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

const REF = 'aqaubrbssnbtomykexgr'
const FN = 'https://youmode.app/api/estimate-meal'
const args = process.argv.slice(2)
const username = args[0]
const dry = args.includes('--dry')
const force = args.includes('--force')
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity
if (!username) { console.error('usage: node scripts/backfill-macros.mjs <username> [--dry] [--limit N] [--force]'); process.exit(1) }

let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) {
  SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key
}
const sb = createClient(`https://${REF}.supabase.co`, SERVICE, { auth: { persistSession: false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MEALISH = /meal|shake|breakfast|lunch|dinner|snack|fuel|extra/i

// estimate-meal requires a real signed-in user and checks entry ownership.
// That guard is worth keeping, so rather than punch a service bypass into a
// public endpoint we mint a genuine session for the account with the admin
// API and call the function exactly the way the app does.
async function sessionFor(email) {
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`could not mint a session: ${error.message}`)
  const hash = data?.properties?.hashed_token
  if (!hash) throw new Error('no token in generated link')
  const ANON = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'anon').api_key
  const user = createClient(`https://${REF}.supabase.co`, ANON, { auth: { persistSession: false } })
  const { data: sess, error: vErr } = await user.auth.verifyOtp({ type: 'magiclink', token_hash: hash })
  if (vErr || !sess?.session?.access_token) throw new Error(`session exchange failed: ${vErr?.message}`)
  return sess.session.access_token
}

async function main() {
  const { data: prof } = await sb.from('profiles').select('id, display_name').eq('username', username).single()
  if (!prof) { console.error(`no such user: ${username}`); process.exit(1) }

  // Verify the migration landed before burning any model calls.
  const { error: colErr } = await sb.from('log_entries').select('est_sat_fat').limit(1)
  if (colErr) {
    console.error('est_sat_fat column is missing. Paste supabase/macro-columns.sql first.')
    process.exit(1)
  }

  const { data: reqs } = await sb.from('requirements')
    .select('id, label, group_label, kind').eq('user_id', prof.id)
  const mealReqIds = new Set((reqs || [])
    .filter((r) => r.kind === 'photo' && MEALISH.test(`${r.label} ${r.group_label || ''}`))
    .map((r) => r.id))
  if (!mealReqIds.size) { console.error('no meal-type requirements found'); process.exit(1) }

  const { data: entries } = await sb.from('log_entries')
    .select('id, requirement_id, caption, photo_path, photo_paths, est_protein, est_calories, est_sat_fat')
    .eq('user_id', prof.id)
  const todo = (entries || [])
    .filter((e) => mealReqIds.has(e.requirement_id))
    .filter((e) => e.caption || e.photo_path || e.photo_paths?.length)
    .filter((e) => force || e.est_sat_fat == null)
    .slice(0, limit)

  const withCaption = todo.filter((e) => e.caption).length
  console.log(`${prof.display_name}: ${todo.length} entries to estimate (${withCaption} with a caption, ${todo.length - withCaption} photo-only)`)
  if (dry) { todo.slice(0, 10).forEach((e) => console.log('  -', (e.caption || '(photo only)').slice(0, 70))); return }

  const token = await sessionFor(`${username}@75hard.app`)
  console.log('session minted, starting\n')

  let ok = 0, failed = 0, skipped = 0
  for (const [i, e] of todo.entries()) {
    try {
      const res = await fetch(FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entryId: e.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (j.ok) {
        ok++
        console.log(`  [${i + 1}/${todo.length}] ${j.calories}kcal ${j.protein}p ${j.satFat}sat ${j.fiber}fib · ${(e.caption || '(photo only)').slice(0, 46)}`)
      } else {
        skipped++
        console.log(`  [${i + 1}/${todo.length}] skipped: ${j.skipped || res.status}`)
      }
    } catch (err) {
      failed++
      console.log(`  [${i + 1}/${todo.length}] error: ${err.message}`)
    }
    await sleep(1200) // stay well under the model rate limit
  }
  console.log(`\ndone — ${ok} estimated, ${skipped} skipped, ${failed} errored`)
}
main().catch((e) => { console.error(e); process.exit(1) })
