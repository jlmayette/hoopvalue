/**
 * Sleeper integration.
 *
 * Sleeper has a completely free, no-auth REST API.
 * Docs: https://docs.sleeper.com/
 *
 * For a given league ID we:
 *   1. GET /league/{id}                → league metadata + scoring settings
 *   2. GET /league/{id}/rosters        → array of rosters with player IDs
 *   3. GET /league/{id}/users          → owner/team display names
 *
 * Rosters reference players by Sleeper's own player_id, which we already have
 * cross-walked in our players table via the seed step.
 */

import { request } from 'undici';
import { NormalizedLeague } from './types';

const BASE = 'https://api.sleeper.app/v1';

async function getJSON<T>(path: string): Promise<T> {
  const { body, statusCode } = await request(`${BASE}${path}`, {
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
  });
  if (statusCode >= 400) {
    throw new Error(`Sleeper API ${statusCode}: ${path}`);
  }
  return (await body.json()) as T;
}

interface SleeperLeague {
  league_id: string;
  name: string;
  total_rosters: number;
  scoring_settings?: Record<string, number>;
  settings?: Record<string, any>;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;          // array of player IDs (as strings)
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
}

interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

function detectScoringFormat(
  settings: Record<string, number> | undefined,
): 'points' | '9cat' | '8cat' | 'other' {
  if (!settings) return 'other';
  // Heuristic: if there are categorical stat keys (steals, blocks…) without a points line, it's a cats league.
  const hasPts = (settings['pts'] ?? 0) !== 0;
  const catKeys = ['stl', 'blk', 'reb', 'ast', 'tov', 'fgm', 'ftm', 'tpm'];
  const catCount = catKeys.filter(k => (settings[k] ?? 0) !== 0).length;
  if (hasPts && catCount === 0) return 'points';
  if (!hasPts && catCount >= 7) return '9cat';
  if (!hasPts && catCount >= 6) return '8cat';
  return 'other';
}

export async function fetchSleeperLeague(leagueId: string): Promise<NormalizedLeague> {
  const [league, rosters, users] = await Promise.all([
    getJSON<SleeperLeague>(`/league/${leagueId}`),
    getJSON<SleeperRoster[]>(`/league/${leagueId}/rosters`),
    getJSON<SleeperUser[]>(`/league/${leagueId}/users`),
  ]);

  const userMap = new Map(users.map(u => [u.user_id, u]));

  return {
    platform: 'sleeper',
    externalId: leagueId,
    leagueName: league.name,
    scoringFormat: detectScoringFormat(league.scoring_settings),
    teamCount: league.total_rosters,
    teams: rosters.map(r => {
      const user = userMap.get(r.owner_id);
      const allPlayers = [
        ...(r.players ?? []),
        ...(r.reserve ?? []),
        ...(r.taxi ?? []),
      ];
      // Dedupe
      const unique = Array.from(new Set(allPlayers));
      return {
        externalId: String(r.roster_id),
        teamName: user?.metadata?.team_name || user?.display_name || `Team ${r.roster_id}`,
        ownerName: user?.display_name ?? null,
        playerIds: { sleeper: unique },
      };
    }),
  };
}
