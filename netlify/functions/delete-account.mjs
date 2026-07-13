// Full account deletion (Apple Guideline 5.1.1). A signed-in user deletes
// THEIR OWN account and all personal data. Careful ordering so foreign keys
// that don't cascade (challenge ownership, referee references) don't block it:
//   1. hand off any challenges they OWN to a co-member (or delete if solo)
//   2. null out day_logs they refereed (reviewed_by has no cascade)
//   3. remove their proof photos from storage (object store isn't FK-cascaded)
//   4. delete the auth user → cascades profile → members, requirements,
//      day_logs, log_entries, body_plans, weigh_ins.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY  (service key bypasses RLS)
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const res = await handle(req)
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v)
  return res
}

async function handle(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SERVICE) return Response.json({ error: 'not configured' }, { status: 503 })

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

  // The JWT identifies the caller — a user can only delete themselves.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return Response.json({ error: 'auth required' }, { status: 401 })
  const { data: uData, error: uErr } = await admin.auth.getUser(jwt)
  const uid = uData?.user?.id
  if (uErr || !uid) return Response.json({ error: 'invalid session' }, { status: 401 })

  const fail = (step, err) => Response.json({ error: `${step}: ${err?.message || err?.msg || JSON.stringify(err)}` }, { status: 500 })
  try {
    // 1) Hand off owned challenges (owner_id has no on-delete cascade).
    const { data: owned, error: e1 } = await admin.from('challenges').select('id').eq('owner_id', uid)
    if (e1) return fail('list-owned', e1)
    for (const c of owned || []) {
      // Prefer another participant; fall back to any other member (e.g. referee).
      const { data: others } = await admin.from('members')
        .select('user_id, role').eq('challenge_id', c.id).neq('user_id', uid)
        .order('role', { ascending: true }) // 'participant' < 'referee' alphabetically
      const heir = others?.find((m) => m.role === 'participant') || others?.[0]
      const { error: eT } = heir
        ? await admin.from('challenges').update({ owner_id: heir.user_id }).eq('id', c.id)
        : await admin.from('challenges').delete().eq('id', c.id) // sole member — remove it
      if (eT) return fail('handoff', eT)
    }

    // Referee references (day_logs.reviewed_by) are released automatically by
    // the ON DELETE SET NULL foreign key when the profile is removed in step 3
    // — a direct update here would be blocked by the verdict-guard trigger.

    // 2) Remove their proof photos from object storage (every path is on a
    //    log_entries row we're about to cascade away, so collect them first).
    const { data: entries, error: e3 } = await admin.from('log_entries')
      .select('photo_path, photo_paths').eq('user_id', uid)
    if (e3) return fail('list-photos', e3)
    const paths = new Set()
    for (const e of entries || []) {
      if (e.photo_path) paths.add(e.photo_path)
      for (const p of e.photo_paths || []) if (p) paths.add(p)
    }
    if (paths.size) {
      const { error: eS } = await admin.storage.from('proof').remove([...paths])
      if (eS) return fail('remove-photos', eS)
    }

    // 3) Delete the auth user → cascades the profile and everything keyed to it
    //    (members, requirements, day_logs, log_entries, body_plans, weigh_ins;
    //    reviewed_by references null out via the FK).
    const { error: dErr } = await admin.auth.admin.deleteUser(uid)
    if (dErr) return fail('delete-user', dErr)

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: `exception: ${e?.message || String(e)}` }, { status: 500 })
  }
}

export const config = { path: '/api/delete-account' }
