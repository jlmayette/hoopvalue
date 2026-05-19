# HoopValue — Dynasty Fantasy Basketball

A working, multi-source dynasty rankings aggregator with live league sync for Sleeper, ESPN, and Fantrax.

```
hoopvalue/
├── backend/         Node.js + TypeScript API
│   ├── src/
│   │   ├── db/             Postgres pool, migrations
│   │   ├── lib/            name matching, value formula, cache
│   │   ├── integrations/   Sleeper, ESPN, Fantrax adapters
│   │   ├── scrapers/       per-source ranking scrapers
│   │   ├── services/       consensus, league sync
│   │   ├── routes/         Express routes
│   │   └── index.ts        server entry with cron
│   └── migrations/   SQL schema
├── frontend/
│   └── public/
│       └── index.html   single-file frontend that consumes the API
└── render.yaml      Render deployment config
```

## What this does

- **Aggregates rankings from 6 expert sources** (RotoWire, RotoBaller, Angle Fantasy Basketball, Athlon, Hashtag Basketball, Dynatyze) on a weekly schedule
- **Computes a weighted-trimmed consensus** rank → value (0–10,000) per player
- **Syncs leagues** from Sleeper (free API), ESPN (public or with cookies), and Fantrax (public leagues)
- **Computes power rankings** by summing each team's roster value
- **Caches with Redis**, persists to Postgres
- **Has a working frontend** that calls all of this

## What works out of the box

- ✓ Sleeper integration (no auth required)
- ✓ ESPN integration (public leagues, or private with user-provided cookies)
- ✓ Fantrax integration (public leagues only; private requires session cookie work)
- ✓ RotoWire, RotoBaller, Angle, Athlon, Hashtag scrapers
- ⚠ Dynatyze scraper is stubbed — page is JS-rendered. See `src/scrapers/dynatyze.ts` for three options to enable it.

---

## Quick start — local dev

### 1. Prereqs
- Node 20+
- A Postgres database (free options: [Neon](https://neon.tech), [Supabase](https://supabase.com), or local `postgres` install)
- An Upstash Redis instance (free tier at [upstash.com](https://upstash.com))

### 2. Backend setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Postgres connection string, Upstash creds, etc.

npm install
npm run migrate         # Create tables
npm run seed-players    # Populate players table from Sleeper (~600 players)
npm run scrape          # Run all scrapers — populates rankings
npm run dev             # Start API on http://localhost:3001
```

### 3. Frontend

The frontend is a single `index.html` file — just open it.

```bash
# In another terminal
cd frontend/public
python3 -m http.server 8000
# Open http://localhost:8000
```

Or use any static server. The frontend auto-detects localhost and points to `http://localhost:3001/api`.

### 4. Try it

- The Rankings tab should show your top 200 ranked players within seconds
- Click **League Analyzer**, paste a Sleeper league ID (it works with any public Sleeper NBA league), and click Analyze
- For ESPN private leagues, you need SWID and espn_s2 from your browser cookies
- For Fantrax, the league has to be public

---

## Production deploy — Render

The included `render.yaml` defines two services: the API and a static frontend that proxies `/api/*` to the API.

### Steps

1. **Push to GitHub.**

2. **Create the database** at [neon.tech](https://neon.tech) — copy the connection string.

3. **Create the Redis instance** at [console.upstash.com](https://console.upstash.com) — copy the REST URL and token.

4. **Sign in to Render**, click "New" → "Blueprint", connect your GitHub repo. Render will detect `render.yaml`.

5. **Set the environment variables** in the Render dashboard:
   - `DATABASE_URL` → your Neon connection string (with `?sslmode=require`)
   - `UPSTASH_REDIS_REST_URL` → from Upstash
   - `UPSTASH_REDIS_REST_TOKEN` → from Upstash
   - `ALLOWED_ORIGINS` → your frontend URL, e.g. `https://hoopvalue-frontend.onrender.com`

6. **First-time setup** — after the API deploys, run migrations and the player seed manually:
   - In Render → your service → Shell tab:
     ```bash
     npm run migrate
     npm run seed-players
     npm run scrape
     ```
   - Or hit the admin endpoint: `curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://hoopvalue-api.onrender.com/api/admin/scrape`

7. **Done.** Cron will refresh weekly on Mondays at 04:00 UTC.

### Cost on free tier
- Render web service: free (sleeps after 15min idle on free tier — first request after sleep is slow)
- Neon Postgres: free up to 3GB
- Upstash Redis: free up to 10k commands/day
- Domain (optional): ~$12/yr

Total: **$0/mo** + domain. Render's free tier sleeps the service when idle; upgrade to the $7/mo "Starter" plan to keep it always-on (recommended for real use).

---

## How rankings work

1. Six scrapers run weekly (cron-scheduled in the API process itself — no separate worker needed for free tier).
2. Each scraper extracts rankings from its source and persists them with timestamp.
3. After all scrapers complete, `recomputeConsensus()` runs:
   - For each player, take the most recent rank from each source
   - Drop highest and lowest (if ≥5 sources)
   - Weight-average by source recency (newer sources count more)
   - Re-rank by weighted average
   - Convert rank to 0–10,000 value via logarithmic decay
4. Frontend hits `/api/rankings` with a 5-min Redis cache.

The hardest piece is **name matching** — every source spells names differently (Jokić vs Jokic, Karl-Anthony vs Karl Anthony, Jr. suffixes, etc.). `src/lib/names.ts` handles this with Unicode normalization, suffix stripping, punctuation removal, and Levenshtein fallback at ≥85% similarity.

## How league sync works

1. Frontend POSTs `/api/leagues/sync` with platform + league ID.
2. Backend calls the appropriate adapter:
   - **Sleeper**: hits 3 endpoints, gets rosters with Sleeper player IDs (which our `players` table already has from the seed).
   - **ESPN**: hits `lm-api-reads.fantasy.espn.com/apis/v3/games/fba/...`, optionally with `SWID` and `espn_s2` cookies. Returns rosters with ESPN player IDs (also cross-walked in our `players` table from Sleeper's player data, which includes `espn_id`).
   - **Fantrax**: POSTs to `fantrax.com/fxpa/req` with `getLeagueInfo` and `getTeamRosterInfo`. Returns player names (Fantrax IDs aren't cross-platform).
3. League sync resolves each roster's player references against our canonical player table — direct ID match first, name fuzzy match as fallback.
4. Power rankings = `SUM(value) GROUP BY team ORDER BY DESC`.

## ESPN private leagues

ESPN has no public API and most leagues are private. To analyze a private league, the user must paste their browser cookies:

1. Log into fantasy.espn.com
2. Open DevTools (F12) → Application → Cookies → fantasy.espn.com
3. Copy the `SWID` value (looks like `{ABCD-1234-5678-EFGH}`, including braces)
4. Copy the `espn_s2` value (long base64-ish string)
5. Paste both into the form

**Security note**: these cookies grant full access to that user's ESPN account. Never store them long-term. The current backend accepts them per-request and doesn't persist them; if you want to support saved leagues, encrypt at rest with `aes-256-gcm` and a server-side key.

## Known limitations

- **Free Render tier sleeps** after 15 min idle. First request after sleep takes ~30s to spin up. Upgrade to Starter ($7/mo) for production.
- **Dynatyze scraper is stubbed** because their page is JS-rendered. See three options in `src/scrapers/dynatyze.ts`.
- **Hashtag Basketball** blocks bots — the scraper handles 403 gracefully and writes nothing, so the system keeps working with 5 sources.
- **Fantrax private leagues** require a session cookie workflow not implemented here. Public leagues only for v1.
- **No user accounts.** Anyone with a league ID can analyze it. Add Clerk or Auth.js if you need multi-user.
- **No picks valuation.** Dynasty rosters often include future draft picks; this build values players only.
- **Scrapers will break** when source sites change HTML. Have a monitoring story (Sentry, Logtail) and budget time to fix selectors.

## License & legal

Personal/educational use. The integrations rely on unofficial endpoints (ESPN, Fantrax) and scraped HTML. Each platform's ToS applies — if you're going commercial, get legal advice and consider hitting them with low request volume and a polite User-Agent.

Player ranking sources are credited and linked. They're aggregated under fair-use commentary, not republished verbatim.
