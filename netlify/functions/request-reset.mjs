// Password reset — step 1: request a link.
// Logins ride on synthetic emails that don't receive mail, so we deliver the
// reset link to the REAL email stored on the profile, via Resend. The link
// carries a short-lived HMAC token (no DB table, no Supabase auth config).
// Always returns ok so it never reveals which accounts exist.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, RESEND_FROM, APP_URL
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const b64u = (s) => Buffer.from(s).toString('base64url')

// token = <payload>.<sig>, payload = base64url(JSON{uid,exp}), sig = HMAC(payload, service key)
export function mintToken(uid, secret, ttlMs = 15 * 60 * 1000) {
  const payload = b64u(JSON.stringify({ uid, exp: Date.now() + ttlMs }))
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
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
  const RESEND = process.env.RESEND_API_KEY
  const FROM = process.env.RESEND_FROM || 'You Mode <noreply@youmode.app>'
  const APP_URL = process.env.APP_URL || 'https://youmode.app'
  if (!SUPABASE_URL || !SERVICE) return Response.json({ error: 'not configured' }, { status: 503 })

  const ok = () => Response.json({ ok: true }) // generic response either way
  try {
    const { identifier } = await req.json()
    const id = (identifier || '').trim()
    if (!id) return Response.json({ error: 'enter your username or email' }, { status: 400 })

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
    const col = id.includes('@') ? 'email' : 'username'
    const val = id.includes('@') ? id.toLowerCase() : id.toLowerCase()
    const { data: prof } = await admin.from('profiles').select('id, email').ilike(col, val).maybeSingle()
    if (!prof || !prof.email) return ok() // no account, or no recovery email on file

    const token = mintToken(prof.id, SERVICE)
    const link = `${APP_URL}/reset?token=${encodeURIComponent(token)}`
    if (RESEND) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: prof.email,
          subject: 'Reset your You Mode password',
          html: `<div style="font-family:-apple-system,Helvetica,sans-serif;color:#2A130B;max-width:440px;margin:0 auto;padding:24px">
            <div style="font:900 30px/1 Arial Black,sans-serif;color:#FF7A55">YOU <span style="font-size:16px;letter-spacing:3px;color:#2A130B">MODE</span></div>
            <p style="font-size:15px;line-height:1.6;color:#3a2a20">Someone asked to reset the password for your You Mode account. If that was you, tap the button below. The link works for 15 minutes.</p>
            <a href="${link}" style="display:inline-block;background:#FF6B4A;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px;margin:8px 0">Set a new password</a>
            <p style="font-size:12px;color:#8a7a6f;line-height:1.5">If you didn't ask for this, you can ignore this email. Your password stays the same.</p>
          </div>`,
        }),
      }).catch(() => {})
    }
    return ok()
  } catch {
    return Response.json({ ok: true })
  }
}

export const config = { path: '/api/request-reset' }
