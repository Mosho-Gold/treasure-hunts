# Foggy: secure Etsy verification and no-purchase testing

**Status: prepared on a draft branch; not deployed or enabled for customers.** Starfall is unchanged.

## Backend

- The public customer endpoint will be `/functions/v1/foggy-etsy-verify`.
- Real receipts are checked through the existing connected Etsy shop (read-only shop ID and refresh token from `starfall_etsy_config`).
- Customers are authorized only for **paid/completed receipts whose transactions contain Foggy's own listing ID**.
- Foggy has dedicated `foggy_etsy_orders` / `foggy_etsy_devices` tables. No Starfall access is shared.
- The three-device restriction for paid orders is retained.

## Testing without purchasing

**A. Automated mock tests:** `deno test --allow-none supabase/functions/foggy-etsy-verify/receipt_rules_test.ts`

These test paid, completed, canceled, unpaid, nonexistent, missing listing, missing transactions, and **Starfall-only order rejected for Foggy**. They do not contact Etsy or require orders. The GitHub test workflow runs automatically for the draft PR.

**B. Owner test access:** The endpoint supports a distinct `testCode` request **only** if these server-side Supabase Edge Function secrets are configured:

- `FOGGY_TEST_MODE=enabled` (leave unset or disabled in production)
- `FOGGY_TEST_CODE_SHA256` = SHA-256 **hex digest** of a randomly generated 32-byte (or longer) owner code; never put the plaintext in source control, client HTML, or a parent guide.

Example generating a high-entropy owner code **locally** (do not paste it into chat):

```bash
python -c "import secrets,hashlib; x=secrets.token_urlsafe(32); print('Your private code:',x); print('Server SHA-256:',hashlib.sha256(x.encode()).hexdigest())"
```

After the migration and Edge Function deploy, test from your own device by POSTing to the endpoint:

```json
{"deviceId":"a-random-long-device-id-123", "testCode":"YOUR_PRIVATE_OWNER_CODE"}
```

A successful response gives a random `activationToken` and `expiresAt`. Test again with:

```json
{"deviceId":"a-random-long-device-id-123", "activationToken":"TOKEN_FROM_PREVIOUS_RESPONSE"}
```

Test activations are stored **only** in `foggy_test_devices`, never in a paid-order table; expire after 7 days; can be revoked by setting `revoked=true`, and all become invalid when `FOGGY_TEST_MODE` is disabled. A purchased customer still follows Etsy validation.

## What remains before any deploy

1. Create and confirm Foggy's Etsy listing and numeric **FOGGY_LISTING_ID**.
2. Configure `FOGGY_LISTING_ID` and owner-test secrets in Supabase (not GitHub source files).
3. Apply the separate Foggy SQL migrations.
4. Deploy `foggy-etsy-verify` via approved Supabase workflow; ensure deployment does **not** alter Starfall codes, database objects, or URL.
5. Add the Foggy customer activation screen and a separate **owner testing interface** only after end-to-end server tests.
6. Test real Etsy API receipt response semantics before launch. Mock tests do not prove live Etsy integration.

Do not merge this draft PR until deployment and access plan are reviewed.
