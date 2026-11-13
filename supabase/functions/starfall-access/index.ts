import { createClient } from 'npm:@supabase/supabase-js@^2.95.0'

const allowedOrigins = new Set([
  'https://mosho-gold.github.io',
])

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowOrigin = allowedOrigins.has(origin) ? origin : 'https://mosho-gold.github.io'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function normalizeCode(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function cleanDeviceId(value: unknown) {
  const v = String(value || '').trim()
  return /^[a-zA-Z0-9_-]{12,120}$/.test(v) ? v : ''
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')!
  const secretJson = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secret = secretJson ? JSON.parse(secretJson)['default'] : legacy
  if (!url || !secret) throw new Error('Supabase server credentials are unavailable')
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405)

  let body: any
  try { body = await req.json() } catch { return json(req, { ok: false, error: 'INVALID_REQUEST' }, 400) }

  const deviceId = cleanDeviceId(body?.deviceId)
  if (!deviceId) return json(req, { ok: false, error: 'INVALID_DEVICE' }, 400)

  const db = adminClient()

  // Returning customers: validate the locally stored activation token.
  if (body?.activationToken) {
    const token = String(body.activationToken)
    const tokenHash = await sha256(token)
    const { data, error } = await db
      .from('starfall_access_devices')
      .select('id,device_id,access_code_id,starfall_access_codes!inner(active,expires_at)')
      .eq('activation_token_hash', tokenHash)
      .eq('device_id', deviceId)
      .maybeSingle()

    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
    const code: any = data?.starfall_access_codes
    const expired = code?.expires_at && new Date(code.expires_at).getTime() < Date.now()

    if (data && code?.active && !expired) {
      await db.from('starfall_access_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
      return json(req, { ok: true, authorized: true })
    }
    return json(req, { ok: false, authorized: false, error: 'ACTIVATION_INVALID' }, 401)
  }

  // New activation: verify purchase code without ever storing its plaintext value.
  const code = normalizeCode(body?.code)
  if (code.length < 8) return json(req, { ok: false, error: 'INVALID_CODE' }, 400)

  const codeHash = await sha256(code)
  const { data: access, error: accessError } = await db
    .from('starfall_access_codes')
    .select('id,active,max_devices,expires_at')
    .eq('code_hash', codeHash)
    .maybeSingle()

  if (accessError) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
  if (!access || !access.active) return json(req, { ok: false, error: 'CODE_NOT_RECOGNIZED' }, 401)
  if (access.expires_at && new Date(access.expires_at).getTime() < Date.now()) {
    return json(req, { ok: false, error: 'CODE_EXPIRED' }, 401)
  }

  const { data: existing } = await db
    .from('starfall_access_devices')
    .select('id')
    .eq('access_code_id', access.id)
    .eq('device_id', deviceId)
    .maybeSingle()

  if (!existing) {
    const { count, error: countError } = await db
      .from('starfall_access_devices')
      .select('id', { count: 'exact', head: true })
      .eq('access_code_id', access.id)

    if (countError) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
    if ((count || 0) >= access.max_devices) {
      return json(req, { ok: false, error: 'DEVICE_LIMIT_REACHED' }, 403)
    }
  }

  const token = randomToken()
  const tokenHash = await sha256(token)
  const now = new Date().toISOString()

  if (existing) {
    const { error } = await db.from('starfall_access_devices')
      .update({ activation_token_hash: tokenHash, last_seen_at: now })
      .eq('id', existing.id)
    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
  } else {
    const { error } = await db.from('starfall_access_devices').insert({
      access_code_id: access.id,
      device_id: deviceId,
      activation_token_hash: tokenHash,
      activated_at: now,
      last_seen_at: now,
    })
    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
  }

  return json(req, { ok: true, authorized: true, activationToken: token })
})
