import { Router, Request, Response } from 'express';
import { query } from '../db/pool';
import { cached } from '../lib/cache';

export const rankingsRouter = Router();

/** GET /api/rankings — full consensus rankings */
rankingsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
  const position = req.query.position as string | undefined;

  const data = await cached(
    `rankings:${limit}:${position ?? 'all'}`,
    300, // 5 min TTL
    async () => {
      const where: string[] = [];
      const params: any[] = [];
      if (position && ['G', 'F', 'C'].includes(position)) {
        params.push(position);
        where.push(`p.position = $${params.length}`);
      }
      const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
      params.push(limit);

      const rows = await query(`
        SELECT
          cr.rank,
          cr.value,
          cr.num_sources,
          cr.rank_stddev AS stddev,
          p.id          AS player_id,
          p.full_name   AS name,
          p.team,
          p.position,
          p.age
        FROM consensus_rankings cr
        JOIN players p ON p.id = cr.player_id
        ${whereSQL}
        ORDER BY cr.rank
        LIMIT $${params.length}
      `, params);

      return rows;
    },
  );

  res.json({ count: data.length, rankings: data });
});

/** GET /api/rankings/sources — list active ranking sources + last scrape time */
rankingsRouter.get('/sources', async (_req: Request, res: Response) => {
  const rows = await query(`
    SELECT slug, display_name, source_url, weight, active, last_scraped_at
    FROM ranking_sources
    ORDER BY display_name
  `);
  res.json({ sources: rows });
});

/** GET /api/rankings/player/:id — single player detail with per-source breakdown */
rankingsRouter.get('/player/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }

  const [player] = await query(`
    SELECT p.*, cr.rank AS consensus_rank, cr.value AS consensus_value,
           cr.num_sources, cr.rank_stddev AS stddev
    FROM players p
    LEFT JOIN consensus_rankings cr ON cr.player_id = p.id
    WHERE p.id = $1
  `, [id]);

  if (!player) {
    res.status(404).json({ error: 'player not found' });
    return;
  }

  const sourceRanks = await query(`
    SELECT src.slug, src.display_name, sr.rank, sr.scraped_at
    FROM source_rankings sr
    JOIN ranking_sources src ON src.id = sr.source_id
    JOIN (
      SELECT source_id, MAX(scraped_at) AS latest
      FROM source_rankings WHERE player_id = $1 GROUP BY source_id
    ) latest ON latest.source_id = sr.source_id AND latest.latest = sr.scraped_at
    WHERE sr.player_id = $1
    ORDER BY sr.rank
  `, [id]);

  res.json({ player, sourceRanks });
});
