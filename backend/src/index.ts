import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';

import { rankingsRouter } from './routes/rankings';
import { leaguesRouter } from './routes/leagues';
import { adminRouter } from './routes/admin';
import { runAllScrapers } from './scrapers/run-all';
import { bootstrapIfNeeded } from './scrapers/bootstrap';

const app = express();

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                 // server-to-server / curl
    if (allowedOrigins.length === 0) return cb(null, true); // dev: allow all
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked'));
  },
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '256kb' }));

// Rate limiting (gentle — adjust as needed)
app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Liveness
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Routes
app.use('/api/rankings', rankingsRouter);
app.use('/api/leagues', leaguesRouter);
app.use('/api/admin', adminRouter);

// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, async () => {
  console.log(`HoopValue API listening on :${port}`);
  console.log(`Allowed origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'ALL (dev)'}`);
  try {
    await bootstrapIfNeeded();
  } catch (err) {
    console.error('Bootstrap failed (server still running):', err);
  }
});

// Schedule weekly scrapes (Mondays at 04:00 UTC by default)
const cronExpr = process.env.SCRAPE_RANKINGS_CRON || '0 4 * * 1';
if (cron.validate(cronExpr)) {
  cron.schedule(cronExpr, () => {
    console.log(`[cron] Running scheduled scrape (${cronExpr})…`);
    runAllScrapers()
      .then(s => console.log('[cron] complete:', s.map(x => x.source).join(', ')))
      .catch(err => console.error('[cron] failed:', err));
  });
  console.log(`Scheduled rankings scrape: ${cronExpr}`);
} else {
  console.warn(`Invalid SCRAPE_RANKINGS_CRON: ${cronExpr} — scheduler disabled.`);
}
