import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { syncLeague, computePowerRankings, Platform } from '../services/league-sync';
import { query } from '../db/pool';

export const leaguesRouter = Router();

const SyncSchema = z.object({
  platform: z.enum(['sleeper', 'espn', 'fantrax']),
  externalId: z.string().min(1).max(64),
  // For ESPN private leagues
  espnSwid: z.string().optional(),
  espnS2: z.string().optional(),
});

/**
 * POST /api/leagues/sync
 * Body: { platform, externalId, espnSwid?, espnS2? }
 * Syncs the league from the platform's API into our database and returns power rankings.
 */
leaguesRouter.post('/sync', async (req: Request, res: Response) => {
  const parsed = SyncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid input', details: parsed.error.flatten() });
    return;
  }
  const { platform, externalId, espnSwid, espnS2 } = parsed.data;

  try {
    const opts = platform === 'espn' && espnSwid && espnS2
      ? { espn: { swid: espnSwid, s2: espnS2 } }
      : {};

    const { leagueDbId, teamCount, unmatchedPlayerCount } = await syncLeague(
      platform as Platform,
      externalId,
      opts,
    );

    const [league] = await query(
      `SELECT id, platform, external_id, league_name, scoring_format, team_count, last_synced_at
       FROM leagues WHERE id = $1`,
      [leagueDbId],
    );

    const powerRankings = await computePowerRankings(leagueDbId);

    res.json({
      league,
      teamCount,
      unmatchedPlayerCount,
      powerRankings,
    });
  } catch (err) {
    const msg = (err as Error).message;
    res.status(400).json({ error: msg });
  }
});

/** GET /api/leagues/:id/power-rankings — recompute from stored roster */
leaguesRouter.get('/:id/power-rankings', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const powerRankings = await computePowerRankings(id);
  res.json({ powerRankings });
});
