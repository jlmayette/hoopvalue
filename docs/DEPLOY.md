# Deploy guide — beginner friendly

If you've never deployed a Node app before, this walks through every click.

## What you'll create
- 1 GitHub repo (the code)
- 1 Neon project (Postgres database) — free
- 1 Upstash database (Redis cache) — free
- 1 Render Blueprint (API + frontend) — free with sleeps, $7/mo to always-on

Total time: ~30 min. Total cost: $0 to start.

---

## Step 1 — Push to GitHub

If you have the code locally:

```bash
cd hoopvalue
git init
git add .
git commit -m "Initial HoopValue"
```

Then on github.com:
1. Click "New repository", name it `hoopvalue`, keep it public or private
2. Don't initialize with README — your local one wins
3. Follow the "push existing repo" instructions GitHub shows you, e.g.:
   ```bash
   git remote add origin https://github.com/YOU/hoopvalue.git
   git branch -M main
   git push -u origin main
   ```

---

## Step 2 — Create Postgres at Neon

1. Go to **https://neon.tech**, sign up with GitHub
2. Click **New Project**
3. Name: `hoopvalue`, region nearest to your Render region (default Oregon)
4. After creation, click **Connection Details**
5. Copy the **Connection String** — it'll look like:
   ```
   postgresql://username:password@ep-xxx.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```
6. **Save this** — you'll paste it into Render in Step 4.

---

## Step 3 — Create Redis at Upstash

1. Go to **https://console.upstash.com**, sign up with GitHub
2. Click **Create Database**
3. Name: `hoopvalue-cache`, region nearest your Render region, type "Regional"
4. Click **Create**
5. On the database page, find the **REST API** section
6. Copy two values:
   - `UPSTASH_REDIS_REST_URL` (looks like `https://xxx.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (long string)
7. **Save these** — you'll paste into Render in Step 4.

---

## Step 4 — Deploy to Render

1. Go to **https://render.com**, sign up with GitHub
2. Click **New +** → **Blueprint**
3. **Connect your GitHub** if prompted, then select your `hoopvalue` repo
4. Render will detect the `render.yaml` and show two services: `hoopvalue-api` and `hoopvalue-frontend`
5. Click **Apply**
6. On the next screen, Render asks for the environment variables that have `sync: false`:
   - `DATABASE_URL` → paste from Step 2 (the Neon connection string)
   - `UPSTASH_REDIS_REST_URL` → paste from Step 3
   - `UPSTASH_REDIS_REST_TOKEN` → paste from Step 3
   - `ALLOWED_ORIGINS` → **leave blank for now**, fill in after deploy with your frontend URL
7. Click **Apply** again. Render starts building.
8. Wait 3-5 minutes for the API to deploy. You can watch logs in real time.

---

## Step 5 — First-time database setup

The schema isn't created yet. You need to run migrations and seed players.

1. In Render, click on **hoopvalue-api** service
2. Click the **Shell** tab (top nav)
3. Run these commands one by one:
   ```bash
   npm run migrate
   npm run seed-players
   npm run scrape
   ```
4. Wait for each to finish (the scrape can take 1-2 min).

---

## Step 6 — Fix CORS

1. Once both services are deployed, click on **hoopvalue-frontend** and copy its URL (e.g., `https://hoopvalue-frontend-abc.onrender.com`)
2. Go back to **hoopvalue-api** → Environment tab
3. Edit `ALLOWED_ORIGINS` → paste the frontend URL
4. Save. The API will restart automatically.

---

## Step 7 — Try it

1. Open your frontend URL in a browser
2. The top-right "API connected" pill should turn green
3. Rankings should load
4. Click **League Analyzer**, paste any Sleeper league ID like `1131234567890123456`, and click Analyze

---

## Troubleshooting

**"API offline" red dot:**
- Check Render logs for the API service
- Most common: `ALLOWED_ORIGINS` doesn't include the frontend URL
- Or the API service is still spinning up (free tier sleeps after 15 min)

**Rankings tab is empty:**
- Did you run `npm run seed-players` and `npm run scrape` in the Render Shell?
- Check API logs for scraper errors — some sources (Hashtag, Dynatyze) may fail; that's expected

**"Sync failed" on league analyzer:**
- For Sleeper: make sure you're using a real NBA league ID (basketball, not football)
- For ESPN private: did you paste both SWID and espn_s2? The SWID needs the curly braces
- For Fantrax: did you set the league public? Commissioner → League Setup → Misc

**Database connection errors:**
- Make sure `DATABASE_URL` ends with `?sslmode=require` for Neon

---

## Going further

- **Custom domain**: Render supports custom domains for free. Settings → Custom Domain on each service.
- **Always-on**: Upgrade hoopvalue-api to Starter ($7/mo) to stop the sleep behavior
- **Monitoring**: Add Sentry (`@sentry/node`) — it's free for hobby use
- **More sources**: Add new scrapers in `src/scrapers/`, then add them to `SCRAPERS` in `run-all.ts`
- **Picks valuation**: Add a `draft_picks` table and a separate value column for them
- **User accounts**: Use Clerk or Supabase Auth, then add a `user_leagues` join table
