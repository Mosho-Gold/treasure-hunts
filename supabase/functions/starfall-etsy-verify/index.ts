import { createClient } from 'npm:@supabase/supabase-js@^2.95.0'

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

async function getEtsyAccessToken() {
  const keystring = Deno.env.get('ETSY_KEYSTRING') || ''
  const refreshToken = Deno.env.get('ETSY_REFRESH_TOKEN') || ''
  if (!keystring || !refreshToken) throw new Error('Etsy OAuth secrets are not configured')

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

async function fetchEtsyReceipt(receiptId: string) {
  const keystring = Deno.env.get('ETSY_KEYSTRING') || ''
  const sharedSecret = Deno.env.get('ETSY_SHARED_SECRET') || ''
  const shopId = Deno.env.get('ETSY_SHOP_ID') || ''
  if (!keystring || !sharedSecret || !shopId) throw new Error('Etsy app secrets are not configured')

  const token = await getEtsyAccessToken()
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405)

  let body: any
  try { body = await req.json() } catch { return json(req, { ok: false, error: 'INVALID_REQUEST' }, 400) }

  const deviceId = cleanDeviceId(body?.deviceId)
  if (!deviceId) return json(req, { ok: false, error: 'INVALID_DEVICE' }, 400)

  const db = adminClient()

  if (body?.activationToken) {
    const tokenHash = await sha256(String(body.activationToken))
    const { data, error } = await db
      .from('starfall_etsy_devices')
      .select('id,device_id,receipt_id,starfall_etsy_orders!inner(order_status)')
      .eq('activation_token_hash', tokenHash)
      .eq('device_id', deviceId)
      .maybeSingle()

    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
    const order: any = data?.starfall_etsy_orders
    if (data && ['paid','completed'].includes(String(order?.order_status || '').toLowerCase())) {
      await db.from('starfall_etsy_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
      return json(req, { ok: true, authorized: true })
    }
    return json(req, { ok: false, authorized: false, error: 'ACTIVATION_INVALID' }, 401)
  }

  const receiptId = cleanReceiptId(body?.orderNumber)
  if (!receiptId) return json(req, { ok: false, error: 'INVALID_ORDER_NUMBER' }, 400)

  let receipt: any
  try { receipt = await fetchEtsyReceipt(receiptId) }
  catch (e) { console.error(e); return json(req, { ok: false, error: 'ETSY_LOOKUP_FAILED' }, 502) }

  if (!receipt) return json(req, { ok: false, error: 'ORDER_NOT_FOUND' }, 404)

  const status = String(receipt.status || '').toLowerCase()
  if (!['paid','completed'].includes(status)) {
    return json(req, { ok: false, error: status === 'canceled' ? 'ORDER_CANCELED' : 'ORDER_NOT_PAID' }, 403)
  }

  const starfallListingId = String(Deno.env.get('STARFALL_LISTING_ID') || '')
  if (!starfallListingId) return json(req, { ok: false, error: 'SERVER_NOT_CONFIGURED' }, 500)

  const transactions = Array.isArray(receipt.transactions) ? receipt.transactions : []
  const ownsStarfall = transactions.some((t: any) => String(t?.listing_id || '') === starfallListingId)
  if (!ownsStarfall) return json(req, { ok: false, error: 'STARFALL_NOT_IN_ORDER' }, 403)

  const now = new Date().toISOString()
  const { error: orderError } = await db.from('starfall_etsy_orders').upsert({
    receipt_id: receiptId,
    listing_id: starfallListingId,
    buyer_user_id: receipt.buyer_user_id ? String(receipt.buyer_user_id) : null,
    order_status: status,
    max_devices: 3,
    verified_at: now,
    last_checked_at: now,
  }, { onConflict: 'receipt_id' })

  if (orderError) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)

  const { data: existing } = await db
    .from('starfall_etsy_devices')
    .select('id')
    .eq('receipt_id', receiptId)
    .eq('device_id', deviceId)
    .maybeSingle()

  if (!existing) {
    const { count, error: countError } = await db
      .from('starfall_etsy_devices')
      .select('id', { count: 'exact', head: true })
      .eq('receipt_id', receiptId)

    if (countError) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
    if ((count || 0) >= 3) return json(req, { ok: false, error: 'DEVICE_LIMIT_REACHED' }, 403)
  }

  const activationToken = randomToken()
  const tokenHash = await sha256(activationToken)

  if (existing) {
    const { error } = await db.from('starfall_etsy_devices')
      .update({ activation_token_hash: tokenHash, last_seen_at: now })
      .eq('id', existing.id)
    if (error) return json(req, { ok: false, error: 'SERVER_ERROR' }, 500)
  } else {
    const { error } = await db.from('starfall_etsy_devices').insert({
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
