/**
 * ESPN Fantasy Basketball integration.
 *
 * ESPN has no official public API. We use their internal v3 endpoint:
 *   https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{year}/segments/0/leagues/{leagueId}
 *
 * For PUBLIC leagues, no auth needed.
 * For PRIVATE leagues, two cookies must be passed:
 *   - SWID (looks like {ABCD-1234-...})
 *   - espn_s2 (long alphanumeric token)
 *
 * Users find these in their browser's DevTools:
 *   1. Log in to fantasy.espn.com
 *   2. Open DevTools → Application → Cookies → fantasy.espn.com
 *   3. Copy SWID and espn_s2 values
 *
 * We never store these in plaintext in production — encrypt at rest if you keep them.
 */

import { request } from 'undici';
import { NormalizedLeague, NormalizedTeam } from './types';

interface EspnTeam {
  id: number;
  name?: string;                       // 2024+: name field
  location?: string;                   // older format: location + nickname
  nickname?: string;
  abbrev?: string;
  primaryOwner?: string;
  owners?: string[];
  roster?: {
    entries: Array<{
      playerId: number;
      playerPoolEntry: { player: { id: number; fullName: string } };
    }>;
  };
}

interface EspnLeague {
  id: number;
  settings: {
    name: string;
    size: number;
    scoringSettings?: {
      scoringType?: number;            // 0 = H2H Points, 1 = H2H Cat, 2 = Roto
    };
  };
  teams: EspnTeam[];
  members?: Array<{ id: string; displayName?: string; firstName?: string; lastName?: string }>;
}

function currentSeason(): number {
  // ESPN season runs Oct-Jun. Use the year of the playoffs.
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

export async function fetchEspnLeague(
  leagueId: string,
  cookies?: { swid?: string; s2?: string },
  season: number = currentSeason(),
): Promise<NormalizedLeague> {
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}` +
    `/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster&view=mSettings`;

  const headers: Record<string, string> = {
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (compatible; HoopValue/0.1)',
  };
  if (cookies?.swid && cookies?.s2) {
    headers['cookie'] = `SWID=${cookies.swid}; espn_s2=${cookies.s2}`;
  }

  const { body, statusCode } = await request(url, {
    headers,
    headersTimeout: 20_000,
    bodyTimeout: 20_000,
  });

  if (statusCode === 401) {
    throw new Error(
      'ESPN league is private — provide valid SWID and espn_s2 cookies.',
    );
  }
  if (statusCode === 404) {
    throw new Error(
      'ESPN league not found. Check the league ID and that the season is correct.',
    );
  }
  if (statusCode >= 400) {
    throw new Error(`ESPN API returned ${statusCode}`);
  }

  const data = (await body.json()) as EspnLeague;
  const memberMap = new Map(
    (data.members ?? []).map(m => [
      m.id,
      m.displayName || `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || 'Unknown',
    ]),
  );

  const teams: NormalizedTeam[] = data.teams.map(t => {
    const name =
      t.name ||
      [t.location, t.nickname].filter(Boolean).join(' ').trim() ||
      `Team ${t.id}`;
    const primaryOwnerId = t.primaryOwner || t.owners?.[0];
    const ownerName = primaryOwnerId ? memberMap.get(primaryOwnerId) ?? null : null;

    const espnPlayerIds: string[] = [];
    const playerNames: string[] = [];
    for (const entry of t.roster?.entries ?? []) {
      const p = entry.playerPoolEntry?.player;
      if (!p) continue;
      espnPlayerIds.push(String(p.id));
      if (p.fullName) playerNames.push(p.fullName);
    }

    return {
      externalId: String(t.id),
      teamName: name,
      ownerName,
      playerIds: { espn: espnPlayerIds, names: playerNames },
    };
  });

  // Detect format
  const scoringType = data.settings.scoringSettings?.scoringType;
  let format: NormalizedLeague['scoringFormat'] = 'other';
  if (scoringType === 0) format = 'points';
  else if (scoringType === 1 || scoringType === 2) format = '9cat';

  return {
    platform: 'espn',
    externalId: leagueId,
    leagueName: data.settings.name,
    scoringFormat: format,
    teamCount: data.settings.size,
    teams,
  };
}
