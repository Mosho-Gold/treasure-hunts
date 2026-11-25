# Foggy companion — staging branch

This branch adds a **separate** Foggy Etsy-order verification endpoint and DB tables, while keeping the existing Starfall tables and verifier unchanged.

- Endpoint when deployed: `/functions/v1/foggy-etsy-verify`
- Shared Etsy OAuth connection: existing `starfall_etsy_config` row (shop ID and refresh token only).
- Required new **Supabase Edge Function secret**: `FOGGY_LISTING_ID` must be the numeric listing ID of **The Wizard's Lost Name** (never use Starfall's ID).
- Device limit: up to 3 devices per order, mirroring the existing Starfall code.
- Frontend should store a **Foggy-specific** random device ID and activation token, not Starfall's.
- Deploy after configuring the listing ID and reviewing the release; do **not** deploy before the Etsy listing exists.
- This branch does not update the live Starfall frontend or run a production deployment.

Notes: The current verification logic follows the existing Starfall implementation. Verify Etsy receipt-status behavior and perform an end-to-end authorized purchase test before launch. Production deployment workflow would need `FOGGY_LISTING_ID` configured as a GitHub Actions secret (and forwarded to Supabase), or set directly in Supabase.
