# QuestForge — Treasure Hunts

This repository hosts two **independent game frontends** and the shared operational infrastructure.

```text
treasure-hunts/
├── index.html                 # QuestForge landing page
├── general/                   # Shared documentation/assets
├── foggy/                     # The Wizard's Lost Name app
│   └── index.html
├── starfall/                  # Project Starfall app
│   ├── index.html
│   ├── assets/
│   ├── manifest.webmanifest
│   └── sw.js
├── supabase/                  # Backend configuration, functions, migrations
└── .github/workflows/         # Deployment automation
```

Public pages:
- Hub: https://mosho-gold.github.io/treasure-hunts/
- Starfall: https://mosho-gold.github.io/treasure-hunts/starfall/
- Foggy: https://mosho-gold.github.io/treasure-hunts/foggy/

**Deployment:** GitHub Pages publishes from the `main` branch; Supabase is managed separately through the existing GitHub Actions workflow. Do not move `supabase/` or `.github/` without updating deployment settings. Foggy Etsy backend is currently only in a draft pull request and is not deployed.

Each app keeps its own progress in browser storage and has independent code. Changes to either game should be made inside its own folder.
