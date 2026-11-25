# QuestForge — shared resources

This directory is reserved for shared site assets and documentation used by Foggy and Starfall. Existing GitHub Pages root files remain in place to preserve Starfall's current customer URL.

App folders:
- `/starfall/` — isolated copy of the live Starfall frontend and its assets.
- `/foggy/` — Foggy companion app. Its HTML still needs to be uploaded before the game URL becomes playable.

Infrastructure remains at repository root:
- `/supabase/` (migrations and Edge Functions)
- `/.github/workflows/` (GitHub Actions)

Do not move these infrastructure folders into a game folder without updating workflows and Supabase CLI configuration.
