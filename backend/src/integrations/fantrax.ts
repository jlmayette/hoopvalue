/**
 * Fantrax integration.
 *
 * Fantrax has no public API documentation, but their web app uses an internal
 * RPC-style endpoint at:
 *   POST https://www.fantrax.com/fxpa/req
 *
 * It expects a body like:
 *   { msgs: [{ method: "<methodName>", data: { ... } }] }
 *
 * Methods we use:
 *   - getLeagueInfo                  → league name, settings, team list
 *   - getTeamRosterInfo              → players on a specific team
 *
 * Public leagues work without auth. Private leagues need a session cookie set
 * after the user logs in. The Python `fantraxapi` library wraps this same API.
 *
 * To enable: leagues must be made publicly viewable via
 *   Fantrax → Commissioner → League Setup → Misc
 * OR the user must provide their Fantrax session cookie.
 *
 * IMPORTANT: Fantrax may change this endpoint shape at any time. This is the
 * most fragile of the three integrations.
 */

import { request } from 'undici';
import { NormalizedLeague, NormalizedTeam } from './types';

const FANTRAX_RPC = 'https://www.fantrax.com/fxpa/req';

async function fxCall<T>(method: string, data: any, cookie?: string): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (compatible; HoopValue/0.1)',
  };
  if (cookie) headers['cookie'] = cookie;

  const { body, statusCode } = await request(FANTRAX_RPC, {
    method: 'POST',
    headers,
    body: JSON.stringify({ msgs: [{ method, data }] }),
    headersTimeout: 20_000,
    bodyTimeout: 20_000,
  });

  if (statusCode >= 400) {
    throw new Error(`Fantrax RPC ${statusCode}: ${method}`);
  }
  const json = (await body.json()) as any;
  if (json?.responses?.[0]?.data) return json.responses[0].data as T;
  if (json?.pageError) throw new Error(`Fantrax error: ${json.pageError.title || 'unknown'}`);
  throw new Error('Unexpected Fantrax response shape');
}

interface FxLeagueInfo {
  leagueId: string;
  leagueName: string;
  scoringType?: string;
  teamCount?: number;
  teams?: Array<{ teamId: string; name: string; ownerName?: string }>;
}

interface FxRoster {
  rows?: Array<{
    scorer?: {
      scorerId: string;
      name: string;
      teamShortName?: string;
      posShortNames?: string;
    };
  }>;
}

export async function fetchFantraxLeague(
  leagueId: string,
  sessionCookie?: string,
): Promise<NormalizedLeague> {
  // 1. League info — names, teams
  const info = await fxCall<FxLeagueInfo>(
    'getLeagueInfo',
    { leagueId },
    sessionCookie,
  );

  if (!info?.teams || info.teams.length === 0) {
    throw new Error(
      'Fantrax returned no teams. The league may be private — ' +
      'make it public via Commissioner → League Setup → Misc, ' +
      'or provide a session cookie.',
    );
  }

  // 2. For each team, fetch the roster
  const teams: NormalizedTeam[] = [];
  for (const t of info.teams) {
    try {
      const roster = await fxCall<FxRoster>(
        'getTeamRosterInfo',
        { leagueId, teamId: t.teamId },
        sessionCookie,
      );
      const playerNames: string[] = [];
      const fantraxIds: string[] = [];
      for (const row of roster.rows ?? []) {
        if (row.scorer?.name) {
          playerNames.push(row.scorer.name);
          fantraxIds.push(row.scorer.scorerId);
        }
      }
      teams.push({
        externalId: t.teamId,
        teamName: t.name,
        ownerName: t.ownerName ?? null,
        playerIds: { fantrax: fantraxIds, names: playerNames },
      });
    } catch (err) {
      console.warn(`[fantrax] roster fetch failed for team ${t.teamId}: ${(err as Error).message}`);
      teams.push({
        externalId: t.teamId,
        teamName: t.name,
        ownerName: t.ownerName ?? null,
        playerIds: { names: [] },
      });
    }
  }

  // Scoring format detection
  let format: NormalizedLeague['scoringFormat'] = 'other';
  const st = info.scoringType?.toLowerCase() ?? '';
  if (st.includes('point')) format = 'points';
  else if (st.includes('cat')) format = '9cat';

  return {
    platform: 'fantrax',
    externalId: leagueId,
    leagueName: info.leagueName,
    scoringFormat: format,
    teamCount: info.teamCount ?? teams.length,
    teams,
  };
}
