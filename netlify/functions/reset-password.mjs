// Password reset — step 2: redeem the link + set a new password.
// Verifies the HMAC token minted by request-reset (timing-safe, unexpired),
// then updates the auth user's password with the service key.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function verifyToken(token, secret) {
  const [payload, sig] = String(token || '').split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let data
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { return null }
  if (!data?.uid || !data?.exp || Date.now() > data.exp) return null
  return data.uid
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
  try {
    const { token, password } = await req.json()
    if (!password || String(password).length < 6) return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    const uid = verifyToken(token, SERVICE)
    if (!uid) return Response.json({ error: 'This reset link is invalid or has expired. Request a new one.' }, { status: 400 })

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
    const { error } = await admin.auth.admin.updateUserById(uid, { password })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

export const config = { path: '/api/reset-password' }
