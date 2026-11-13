import { createClient } from 'npm:@supabase/supabase-js@^2.95.0'

const REDIRECT_URI = 'https://txqomkghtxfhwvvhjpbo.supabase.co/functions/v1/starfall-etsy-oauth'

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')!
  const secretJson = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secret = secretJson ? JSON.parse(secretJson)['default'] : legacy
  if (!url || !secret) throw new Error('Supabase credentials unavailable')
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
}

function b64url(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}

function randomString(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256b64url(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return b64url(new Uint8Array(hash))
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const keystring = Deno.env.get('ETSY_KEYSTRING') || ''
  const sharedSecret = Deno.env.get('ETSY_SHARED_SECRET') || ''

  if (!keystring || !sharedSecret) {
    return html('<h2>STARFALL Etsy connection is not configured yet.</h2><p>Add ETSY_KEYSTRING and ETSY_SHARED_SECRET to the Supabase Edge Function secrets.</p>', 500)
  }

  const db = adminClient()
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return html('<h2>Etsy authorization was not completed.</h2><p>'+error+'</p>', 400)
  }

  if (code && returnedState) {
    const { data: session, error: sessionError } = await db
      .from('starfall_etsy_oauth_sessions')
      .select('state,code_verifier,expires_at')
      .eq('state', returnedState)
      .maybeSingle()

    if (sessionError || !session || new Date(session.expires_at).getTime() < Date.now()) {
      return html('<h2>Authorization session expired.</h2><p>Start the Etsy connection again.</p>', 400)
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: keystring,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: session.code_verifier,
    })

    const tokenResponse = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    })

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text()
      console.error('Etsy token exchange failed', detail)
      return html('<h2>Could not complete Etsy authorization.</h2><p>Please try again.</p>', 502)
    }

    const tokens = await tokenResponse.json()
    const accessToken = String(tokens.access_token || '')
    const refreshToken = String(tokens.refresh_token || '')
    const userId = accessToken.split('.')[0]

    if (!accessToken || !refreshToken || !/^\d+$/.test(userId)) {
      return html('<h2>Etsy returned an incomplete authorization response.</h2>', 502)
    }

    const shopResponse = await fetch(
      'https://api.etsy.com/v3/application/users/'+encodeURIComponent(userId)+'/shops',
      { headers: { 'x-api-key': keystring+':'+sharedSecret } }
    )

    if (!shopResponse.ok) {
      const detail = await shopResponse.text()
      console.error('Etsy shop lookup failed', detail)
      return html('<h2>Authorized, but the Etsy shop could not be identified.</h2>', 502)
    }

    const shop = await shopResponse.json()
    const shopId = String(shop.shop_id || '')

    if (!shopId) {
      return html('<h2>No Etsy shop was found for the authorized seller.</h2>', 404)
    }

    const { error: saveError } = await db.from('starfall_etsy_config').upsert({
      id: 1,
      refresh_token: refreshToken,
      etsy_user_id: userId,
      shop_id: shopId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    await db.from('starfall_etsy_oauth_sessions').delete().eq('state', returnedState)

    if (saveError) {
      console.error(saveError)
      return html('<h2>Etsy authorization succeeded, but STARFALL could not save the connection.</h2>', 500)
    }

    return html(`<!doctype html><html><head><meta charset="utf-8"><title>STARFALL Etsy Connected</title>
    <style>body{font-family:Arial;background:#031526;color:#eafcff;display:grid;place-items:center;min-height:100vh;margin:0}
    .card{max-width:560px;padding:34px;border:2px solid #31d7ff;border-radius:18px;background:#071c34;text-align:center;box-shadow:0 0 35px #31d7ff33}
    h1{color:#8ff1ff}.ok{font-size:48px;color:#58efb0}</style></head><body><div class="card">
    <div class="ok">✓</div><h1>Etsy shop connected</h1><p>STARFALL can now verify paid Etsy orders for your shop.</p>
    <p><strong>Shop ID:</strong> ${shopId}</p><p>You may close this window.</p></div></body></html>`)
  }

  const state = randomString(24)
  const verifier = randomString(48)
  const challenge = await sha256b64url(verifier)
  const expiresAt = new Date(Date.now()+10*60*1000).toISOString()

  await db.from('starfall_etsy_oauth_sessions').delete().lt('expires_at', new Date().toISOString())
  const { error: insertError } = await db.from('starfall_etsy_oauth_sessions').insert({
    state,
    code_verifier: verifier,
    expires_at: expiresAt,
  })

  if (insertError) {
    console.error(insertError)
    return html('<h2>Could not start Etsy authorization.</h2>', 500)
  }

  const auth = new URL('https://www.etsy.com/oauth/connect')
  auth.searchParams.set('response_type','code')
  auth.searchParams.set('redirect_uri',REDIRECT_URI)
  auth.searchParams.set('scope','transactions_r')
  auth.searchParams.set('client_id',keystring)
  auth.searchParams.set('state',state)
  auth.searchParams.set('code_challenge',challenge)
  auth.searchParams.set('code_challenge_method','S256')

  return Response.redirect(auth.toString(),302)
})
