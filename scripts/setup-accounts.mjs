// ─────────────────────────────────────────────────────────────────────────
// setup-accounts.mjs — finishes 75 Hard setup on the steve-crm Supabase project.
// Run once (AFTER pasting supabase/schema-apply.sql in the SQL editor):
//
//     node scripts/setup-accounts.mjs
//
// It pulls the project's service_role key at runtime from your already-authed
// Supabase CLI (nothing secret is written to disk), then:
//   • ensures the `proof` storage bucket + challenge config exist
//   • creates the 3 logins (kyle/dylen/marcus, password = first name)
//   • seeds their profiles / roles / goals
// Re-running is safe.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

const REF = 'aqaubrbssnbtomykexgr'
const URL = `https://${REF}.supabase.co`
const DOMAIN = '75hard.app'

// Prefer an explicit env var (most reliable). Fall back to the Supabase CLI.
let SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY
if (!SERVICE) {
  try {
    console.log('No SUPABASE_SERVICE_KEY set — trying your Supabase CLI…')
    const out = execSync(`npx --yes supabase@latest projects api-keys --project-ref ${REF}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    SERVICE = JSON.parse(out.match(/\{[\s\S]*\}/)[0]).keys.find((k) => k.name === 'service_role').api_key
  } catch { /* fall through to the message below */ }
}
if (!SERVICE) {
  console.error(`
Need the service_role key. Get it from:
  Supabase dashboard → steve-crm → Project Settings → API Keys → "service_role" (secret) → copy
Then run:
  SUPABASE_SERVICE_KEY='paste-the-key-here' node scripts/setup-accounts.mjs
`)
  process.exit(1)
}

const sb = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

const ROSTER = [
  { name: 'Kyle',   role: 'participant', forfeit: 'Bright red mohawk',  accent: '#FF3B30',
    goal: { label: 'Launch Stance', target: 40, count_label: 'users' } },
  { name: 'Dylen',  role: 'participant', forfeit: 'Shave it all — bald', accent: '#34C759',
    goal: { label: 'Launch the website business', target: 10, count_label: 'paying customers' } },
  { name: 'Marcus', role: 'judge', forfeit: null, accent: '#FFD60A', goal: null },
]

async function existingUsers() {
  const map = {}
  let page = 1
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const u of data.users) map[u.email] = u.id
    if (data.users.length < 200) break
    page++
  }
  return map
}

const run = async () => {
  // sanity: schema applied?
  const { error: tblErr } = await sb.from('profiles').select('id').limit(1)
  if (tblErr) {
    console.error('\n✗ The `profiles` table is missing — paste supabase/schema-apply.sql into the\n  steve-crm SQL editor and run it first, then re-run this script.\n')
    process.exit(1)
  }

  // ensure bucket + config (safety net; the SQL also does these)
  await sb.storage.createBucket('proof', { public: false }).catch(() => {})
  await sb.from('challenge_config').upsert({ id: 1, start_date: '2026-06-30', total_days: 75, timezone: 'America/Denver' })

  const existing = await existingUsers()
  for (const p of ROSTER) {
    const email = `${p.name.toLowerCase()}@${DOMAIN}`
    let id = existing[email]
    if (id) {
      console.log(`• ${p.name}: account exists`)
    } else {
      const { data, error } = await sb.auth.admin.createUser({ email, password: p.name.toLowerCase(), email_confirm: true })
      if (error) { console.error(`✗ ${p.name}: ${error.message}`); process.exit(1) }
      id = data.user.id
      console.log(`✓ ${p.name}: account created`)
    }
    const { error: pe } = await sb.from('profiles').upsert({
      id, display_name: p.name, role: p.role, forfeit_text: p.forfeit, accent: p.accent,
      goal_label: p.goal?.label ?? null, goal_target_count: p.goal?.target ?? null, goal_count_label: p.goal?.count_label ?? null,
    })
    if (pe) { console.error(`✗ ${p.name} profile: ${pe.message}`); process.exit(1) }
    console.log(`  ↳ profile seeded (${p.role})`)
  }
  console.log('\nDone. Live at https://kyle-dylen-75hard.netlify.app')
  console.log('Log in with username = first name, password = first name:')
  console.log('  kyle / kyle   ·   dylen / dylen   ·   marcus / marcus')
}

run().catch((e) => { console.error(e); process.exit(1) })
