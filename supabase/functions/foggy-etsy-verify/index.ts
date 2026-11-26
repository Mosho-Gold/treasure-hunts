import { createClient } from 'npm:@supabase/supabase-js@^2.95.0'
import { evaluateFoggyReceipt } from './receipt_rules.ts'

const ALLOWED_ORIGIN = 'https://mosho-gold.github.io'

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
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

async function sha256(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function cleanDeviceId(value: unknown) {
  const v = String(value || '').trim()
  return /^[a-zA-Z0-9_-]{12,120}$/.test(v) ? v : ''
}

function cleanReceiptId(value: unknown) {
  const v = String(value || '').replace(/\D/g, '')
  return /^\d{6,20}$/.test(v) ? v : ''
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')!
  const secretJson = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secret = secretJson ? JSON.parse(secretJson)['default'] : legacy
  if (!url || !secret) throw new Error('Supabase credentials unavailable')
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function getEtsyAccessToken(refreshToken: string) {
  const keystring = Deno.env.get('ETSY_KEYSTRING') || ''
  if (!keystring || !refreshToken) throw new Error('Etsy OAuth configuration is unavailable')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: keystring,
    refresh_token: refreshToken,
  })

  const r = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!r.ok) throw new Error('Could not refresh Etsy OAuth token')
  const data = await r.json()
  return String(data.access_token || '')
}

async function fetchEtsyReceipt(receiptId: string, shopId: string, refreshToken: string) {
  const keystring = Deno.env.get('ETSY_KEYSTRING') || ''
  const sharedSecret = Deno.env.get('ETSY_SHARED_SECRET') || ''
  if (!keystring || !sharedSecret || !shopId || !refreshToken) throw new Error('Etsy app configuration is unavailable')

  const token = await getEtsyAccessToken(refreshToken)
  const headers = {
    'x-api-key': keystring + ':' + sharedSecret,
    'Authorization': 'Bearer ' + token,
  }

  const url = 'https://api.etsy.com/v3/application/shops/' + encodeURIComponent(shopId) + '/receipts/' + encodeURIComponent(receiptId)
  const r = await fetch(url, { headers })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Etsy receipt lookup failed: ' + r.status)

  const receipt = await r.json()
  if (!Array.isArray(receipt.transactions) || !receipt.transactions.length) {
    const tr = await fetch(url + '/transactions', { headers })
    if (tr.ok) {
      const tx = await tr.json()
      receipt.transactions = Array.isArray(tx.results) ? tx.results : []
    }
  }
  return receipt
}


// Owner-only verification is disabled unless explicitly configured.
// Use a high-entropy test code, stored only as a SHA-256 digest in Supabase secrets.
// Test access never creates or impersonates a paid Etsy order.
function safeHexEqual(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false
  let different = 0
  for (let i = 0; i < 64; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return different === 0
}

async function verifyOwnerTestCode(req: Request, db: ReturnType<typeof adminClient>, deviceId: string, code: unknown) {
  // Separate test credentials from customer receipts; no public master code in HTML.
  if (Deno.env.get('FOGGY_TEST_MODE') !== 'enabled') return json(req, { ok: false, error: 'TEST_ACCESS_DISABLED' }, 403)
  const expectedHash = (Deno.env.get('FOGGY_TEST_CODE_SHA256') || '').toLowerCase()
  const proposed = typeof code === 'string' ? code : ''
  if (proposed.length < 24 || proposed.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(proposed)) {
    return json(req, { ok: false, error: 'INVALID_TEST_CODE' }, 401)
  }
  if (!safeHexEqual(await sha256(proposed), expectedHash)) {
    return json(req, { ok: false, error: 'INVALID_TEST_CODE' }, 401)
  }
  const activationToken = randomToken()
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
  const { error } = await db.from('foggy_test_devices').upsert({
    device_id: deviceId,
    activation_token_hash: await sha256(activationToken),
    expires_at: expiresAt,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'device_id' })
  if (error) {
    console.error('Foggy test activation failed', error.message)
    return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
  }
  return json(req, { ok: true, authorized: true, testMode: true, expiresAt, activationToken })
}

async function checkOwnerTestToken(db: ReturnType<typeof adminClient>, tokenHash: string, deviceId: string) {
  if (Deno.env.get('FOGGY_TEST_MODE') !== 'enabled') return false
  const { data, error } = await db.from('foggy_test_devices')
    .select('device_id,expires_at,revoked')
    .eq('activation_token_hash', tokenHash)
    .eq('device_id', deviceId)
    .maybeSingle()
  if (error || !data || data.revoked || Date.parse(data.expires_at) <= Date.now()) return false
  await db.from('foggy_test_devices').update({ last_seen_at: new Date().toISOString() })
    .eq('device_id', deviceId)
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405)

  let body: any
  try { body = await req.json() } catch { return json(req, { ok: false, error: 'INVALID_REQUEST' }, 400) }

  const deviceId = cleanDeviceId(body?.deviceId)
  if (!deviceId) return json(req, { ok: false, error: 'INVALID_DEVICE' }, 400)

  const db = adminClient()

  if (body?.testCode !== undefined) {
    return verifyOwnerTestCode(req, db, deviceId, body.testCode)
  }

  if (body?.activationToken) {
    const tokenHash = await sha256(String(body.activationToken))
    if (await checkOwnerTestToken(db, tokenHash, deviceId)) {
      return json(req, { ok: true, authorized: true, testMode: true })
    }
    const { data, error } = await db
      .from('foggy_etsy_devices')
      .select('id,device_id,receipt_id,foggy_etsy_orders!inner(order_status)')
      .eq('activation_token_hash', tokenHash)
      .eq('device_id', deviceId)
      .maybeSingle()

    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
    const order: any = data?.foggy_etsy_orders
    if (data && ['paid','completed'].includes(String(order?.order_status || '').toLowerCase())) {
      await db.from('foggy_etsy_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
      return json(req, { ok: true, authorized: true })
    }
    return json(req, { ok: false, authorized: false, error: 'ACTIVATION_INVALID' }, 401)
  }

  const receiptId = cleanReceiptId(body?.orderNumber)
  if (!receiptId) return json(req, { ok: false, error: 'INVALID_ORDER_NUMBER' }, 400)

  const { data: etsyConfig, error: configError } = await db
    .from('starfall_etsy_config')
    .select('refresh_token,shop_id')
    .eq('id',1)
    .maybeSingle()

  if (configError || !etsyConfig?.refresh_token || !etsyConfig?.shop_id) {
    return json(req, { ok: false, error: 'ETSY_NOT_CONNECTED' }, 503)
  }

  let receipt: any
  try { receipt = await fetchEtsyReceipt(receiptId, String(etsyConfig.shop_id), String(etsyConfig.refresh_token)) }
  catch (e) { console.error(e); return json(req, { ok: false, error: 'ETSY_LOOKUP_FAILED' }, 502) }

  const foggyListingId = String(Deno.env.get('FOGGY_LISTING_ID') || '')
  const verdict = evaluateFoggyReceipt(receipt, foggyListingId)
  if (!verdict.ok) {
    const status = verdict.error === 'ORDER_NOT_FOUND' ? 404 :
      verdict.error === 'FOGGY_LISTING_NOT_CONFIGURED' ? 503 : 403
    return json(req, { ok: false, error: verdict.error }, status)
  }
  const status = verdict.status!

  const now = new Date().toISOString()
  const { error: orderError } = await db.from('foggy_etsy_orders').upsert({
    receipt_id: receiptId,
    listing_id: foggyListingId,
    buyer_user_id: receipt.buyer_user_id ? String(receipt.buyer_user_id) : null,
    order_status: status,
    max_devices: 3,
    verified_at: now,
    last_checked_at: now,
  }, { onConflict: 'receipt_id' })

  if (orderError) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)

  const { data: existing } = await db
    .from('foggy_etsy_devices')
    .select('id')
    .eq('receipt_id', receiptId)
    .eq('device_id', deviceId)
    .maybeSingle()

  if (!existing) {
    const { count, error: countError } = await db
      .from('foggy_etsy_devices')
      .select('id', { count: 'exact', head: true })
      .eq('receipt_id', receiptId)

    if (countError) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
    if ((count || 0) >= 3) return json(req, { ok: false, error: 'DEVICE_LIMIT_REACHED' }, 403)
  }

  const activationToken = randomToken()
  const tokenHash = await sha256(activationToken)

  if (existing) {
    const { error } = await db.from('foggy_etsy_devices')
      .update({ activation_token_hash: tokenHash, last_seen_at: now })
      .eq('id', existing.id)
    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
  } else {
    const { error } = await db.from('foggy_etsy_devices').insert({
      receipt_id: receiptId,
      device_id: deviceId,
      activation_token_hash: tokenHash,
      activated_at: now,
      last_seen_at: now,
    })
    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
  }

  return json(req, { ok: true, authorized: true, activationToken })
})
