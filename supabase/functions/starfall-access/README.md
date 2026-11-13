# STARFALL access gate

This Edge Function validates customer purchase codes without exposing the valid-code list in the browser.

Behavior:
- Purchase codes are normalized (uppercase, punctuation removed) and stored only as SHA-256 hashes.
- Each code defaults to 3 activated devices.
- An authorized device receives a random activation token.
- The browser stores that token locally and silently revalidates it on future visits.
- RLS is enabled on both access tables and no public policies are created.
- The Edge Function uses the server-side Supabase secret key.

After deployment, set the frontend `ACCESS_API_URL` in `index.html` to the deployed function URL.

If a custom production domain is added later, add its origin to `allowedOrigins` in `index.ts`.
