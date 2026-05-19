import { Router, Request, Response } from 'express';
import { runAllScrapers } from '../scrapers/run-all';

export const adminRouter = Router();

/** Token-protected manual scrape trigger. */
adminRouter.post('/scrape', async (req: Request, res: Response) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Fire and forget — return immediately
  runAllScrapers()
    .then(summary => console.log('Manual scrape complete:', summary))
    .catch(err => console.error('Manual scrape failed:', err));

  res.json({ ok: true, message: 'Scrape kicked off; check server logs.' });
});
