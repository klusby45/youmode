// E2E for the talk-to-build onboarding. Mints a disposable user, drives the
// deployed /api/onboard-coach through a short simulated ramble until it emits a
// propose_challenge, asserts the proposal is clamped into the app's real
// capability envelope, then replicates createChallenge's writes (challenge with
// total_days + requirements) as that signed-in user and asserts they persist.
// Cleans everything up. The service key is fetched at runtime, never printed.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REF = 'aqaubrbssnbtomykexgr', DOMAIN = '75hard.app', BASE = `https://${REF}.supabase.co`
const COACH = 'https://youmode.app/api/onboard-coach'
const ITEM_ICONS = ['dumbbell', 'run', 'plate', 'camera', 'book', 'drop', 'target', 'bolt', 'clock', 'trophy']
const FORMATS = ['solo', 'versus', 'accountability', 'community']

let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key
const ANON = readFileSync('src/supabaseClient.js', 'utf8').match(/eyJ[A-Za-z0-9_.-]+/)[0]
const admin = createClient(BASE, SERVICE, { auth: { persistSession: false } })
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item'

let pass = true
const check = (n, ok, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'}  ${n}${extra ? '  — ' + extra : ''}`); if (!ok) pass = false; return ok }

async function coach(token, messages) {
  const r = await fetch(COACH, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messages }) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

const run = async () => {
  const email = `zzonboard@${DOMAIN}`
  // fresh disposable user
  let page = 1, id = null
  for (;;) { const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 }); for (const u of data.users) if (u.email === email) id = u.id; if (data.users.length < 200) break; page++ }
  if (id) { await admin.from('profiles').delete().eq('id', id); await admin.auth.admin.deleteUser(id) }
  id = (await admin.auth.admin.createUser({ email, password: 'onbpass123', email_confirm: true })).data.user.id
  await admin.from('profiles').upsert({ id, username: 'zzonboard', display_name: 'Onni', phone: '', role: 'participant' })

  const anon = createClient(BASE, ANON, { auth: { persistSession: false } })
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: 'onbpass123' })
  const token = sess.session.access_token

  // Drive the interview until it proposes (allow 1-2 clarifying turns).
  const msgs = [{ role: 'user', content: 'I want to train for my first half marathon over about the next 3 months. I can run most days and want to lift a couple times a week. Set me up solo, with workout photos and a daily stretching check. Whatever you think is best is fine, just build it.' }]
  let proposal = null, lastReply = ''
  for (let turn = 0; turn < 4 && !proposal; turn++) {
    const { status, body } = await coach(token, msgs)
    if (!check(`coach responds 200 (turn ${turn + 1})`, status === 200, `status ${status}`)) break
    lastReply = body.reply || ''
    if (body.proposal) { proposal = body.proposal; break }
    msgs.push({ role: 'assistant', content: body.reply || '…' })
    msgs.push({ role: 'user', content: 'That all sounds good, go ahead and build it now.' })
  }
  if (!check('coach produced a proposal', !!proposal, lastReply.slice(0, 80))) { await cleanup(id); return finish() }

  console.log('\n  proposal:', JSON.stringify({ name: proposal.name, format: proposal.format, dayCount: proposal.dayCount, items: proposal.items?.length, stake: !!proposal.suggestedStake }))
  check('name is a non-empty string', typeof proposal.name === 'string' && proposal.name.trim().length > 0)
  check('format in enum', FORMATS.includes(proposal.format), proposal.format)
  check('dayCount integer in 7..365', Number.isInteger(proposal.dayCount) && proposal.dayCount >= 7 && proposal.dayCount <= 365, String(proposal.dayCount))
  check('items 1..12', Array.isArray(proposal.items) && proposal.items.length >= 1 && proposal.items.length <= 12, String(proposal.items?.length))
  let itemsOk = true
  for (const it of proposal.items || []) {
    if (!(['photo', 'check'].includes(it.kind) && ITEM_ICONS.includes(it.icon) && typeof it.label === 'string' && it.label.trim())) itemsOk = false
    if (it.minMinutes != null && !(it.kind === 'photo' && it.minMinutes >= 1 && it.minMinutes <= 600)) itemsOk = false
  }
  check('every item normalized (kind/icon/label; minMinutes photo-only)', itemsOk)

  // Replicate createChallenge's writes as the signed-in user (RLS-exercised).
  const total = Math.min(365, Math.max(7, Math.round(proposal.dayCount)))
  const code = 'ZZ' + Math.random().toString(36).slice(2, 6).toUpperCase()
  const { data: ch, error: ce } = await anon.from('challenges')
    .insert({ name: proposal.name, join_code: code, owner_id: id, start_date: '2026-07-14', timezone: 'America/Los_Angeles', format: proposal.format, total_days: total })
    .select().single()
  if (!check('challenge insert (RLS) succeeded', !ce && !!ch, ce?.message)) { await cleanup(id); return finish() }
  check('challenges row carries chosen total_days', ch.total_days === total, `${ch.total_days} vs ${total}`)

  await anon.from('members').insert({ challenge_id: ch.id, user_id: id, role: 'participant', accent: '#FF3B30' })
  // finalizeItems: trim + slugify keys + dedupe (mirrors client + server shape)
  const seen = new Set()
  const rows = (proposal.items || []).map((it, i) => {
    let key = slugify(it.label); while (seen.has(key)) key += '_2'; seen.add(key)
    return { challenge_id: ch.id, user_id: id, key, label: it.label, hint: it.hint || null, group_label: it.group || 'Custom', icon: it.icon, kind: it.kind, sort: i + 1, multi: false, min_minutes: it.kind === 'photo' && it.minMinutes ? it.minMinutes : null }
  })
  const { error: re } = await anon.from('requirements').insert(rows)
  check('requirement rows insert (RLS) succeeded', !re, re?.message)
  const { data: back } = await admin.from('requirements').select('*').eq('challenge_id', ch.id).order('sort')
  check('all requirement rows persisted with kinds/icons', (back || []).length === rows.length && back.every((r) => ['photo', 'check'].includes(r.kind) && ITEM_ICONS.includes(r.icon)))
  const minOk = back.every((r) => r.min_minutes == null || r.kind === 'photo')
  check('min_minutes only on photo rows', minOk)

  await cleanup(id, ch.id)
  finish()
}

async function cleanup(userId, chId) {
  if (chId) {
    await admin.from('requirements').delete().eq('challenge_id', chId)
    await admin.from('members').delete().eq('challenge_id', chId)
    await admin.from('challenges').delete().eq('id', chId)
  }
  if (userId) { await admin.from('profiles').delete().eq('id', userId); await admin.auth.admin.deleteUser(userId) }
}
const finish = () => { console.log(pass ? '\n✓ ONBOARD COACH E2E PASSED — cleaned up' : '\n✗ FAILURES ABOVE'); process.exit(pass ? 0 : 1) }

run().catch((e) => { console.error(e); process.exit(1) })
