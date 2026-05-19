import { pool, query } from '../db/pool';
import { findBestMatch } from '../lib/names';
import { NormalizedLeague, NormalizedTeam, LeagueFetchOptions } from '../integrations/types';
import { fetchSleeperLeague } from '../integrations/sleeper';
import { fetchEspnLeague } from '../integrations/espn';
import { fetchFantraxLeague } from '../integrations/fantrax';

export type Platform = 'sleeper' | 'espn' | 'fantrax';

/** One-stop fetch by platform. */
export async function fetchLeague(
  platform: Platform,
  externalId: string,
  opts: LeagueFetchOptions = {},
): Promise<NormalizedLeague> {
  switch (platform) {
    case 'sleeper':
      return fetchSleeperLeague(externalId);
    case 'espn':
      return fetchEspnLeague(externalId, opts.espn);
    case 'fantrax':
      return fetchFantraxLeague(externalId);
  }
}

/** Resolve a roster's platform-specific player references to canonical player IDs. */
async function resolveRoster(team: NormalizedTeam): Promise<number[]> {
  const resolved: number[] = [];

  // Strategy 1: Sleeper IDs
  if (team.playerIds.sleeper?.length) {
    const rows = await query<{ id: number; sleeper_id: string }>(
      'SELECT id, sleeper_id FROM players WHERE sleeper_id = ANY($1)',
      [team.playerIds.sleeper],
    );
    resolved.push(...rows.map(r => r.id));
    if (resolved.length === team.playerIds.sleeper.length) return resolved;
  }

  // Strategy 2: ESPN IDs
  if (team.playerIds.espn?.length) {
    const rows = await query<{ id: number }>(
      'SELECT id FROM players WHERE espn_id = ANY($1)',
      [team.playerIds.espn],
    );
    resolved.push(...rows.map(r => r.id));
    if (resolved.length === team.playerIds.espn.length) return resolved;
  }

  // Strategy 3: Fantrax IDs (rarely matched directly — Fantrax IDs aren't shared)
  if (team.playerIds.fantrax?.length) {
    const rows = await query<{ id: number }>(
      'SELECT id FROM players WHERE fantrax_id = ANY($1)',
      [team.playerIds.fantrax],
    );
    resolved.push(...rows.map(r => r.id));
  }

  // Strategy 4: Fall back to name fuzzy matching
  if (team.playerIds.names?.length) {
    const candidates = await query<{
      id: number;
      normalized_name: string;
      full_name: string;
    }>('SELECT id, normalized_name, full_name FROM players');
    const matchedIds = new Set(resolved);
    for (const name of team.playerIds.names) {
      const m = findBestMatch(name, candidates);
      if (m && !matchedIds.has(m.id)) {
        resolved.push(m.id);
        matchedIds.add(m.id);
      }
    }
  }

  return Array.from(new Set(resolved));
}

/** Sync a league: fetch from origin, persist league, teams, rosters. Idempotent. */
export async function syncLeague(
  platform: Platform,
  externalId: string,
  opts: LeagueFetchOptions = {},
): Promise<{ leagueDbId: number; teamCount: number; unmatchedPlayerCount: number }> {
  const league = await fetchLeague(platform, externalId, opts);

  const client = await pool.connect();
  let unmatchedTotal = 0;

  try {
    await client.query('BEGIN');

    // Upsert league
    const leagueRows = await client.query<{ id: number }>(
      `INSERT INTO leagues (platform, external_id, league_name, scoring_format, team_count, last_synced_at, metadata)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (platform, external_id) DO UPDATE SET
         league_name = EXCLUDED.league_name,
         scoring_format = EXCLUDED.scoring_format,
         team_count = EXCLUDED.team_count,
         last_synced_at = NOW()
       RETURNING id`,
      [
        league.platform,
        league.externalId,
        league.leagueName,
        league.scoringFormat,
        league.teamCount,
        {}, // metadata placeholder; cookies should be encrypted, never stored plain
      ],
    );
    const leagueDbId = leagueRows.rows[0].id;

    // Wipe existing rosters for this league
    await client.query(
      `DELETE FROM league_rosters WHERE league_team_id IN
         (SELECT id FROM league_teams WHERE league_id = $1)`,
      [leagueDbId],
    );

    // Upsert teams and rosters
    for (const team of league.teams) {
      const teamRows = await client.query<{ id: number }>(
        `INSERT INTO league_teams (league_id, external_id, team_name, owner_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (league_id, external_id) DO UPDATE SET
           team_name = EXCLUDED.team_name,
           owner_name = EXCLUDED.owner_name
         RETURNING id`,
        [leagueDbId, team.externalId, team.teamName, team.ownerName],
      );
      const teamDbId = teamRows.rows[0].id;

      const playerIds = await resolveRoster(team);
      const expectedCount =
        team.playerIds.sleeper?.length ??
        team.playerIds.espn?.length ??
        team.playerIds.fantrax?.length ??
        team.playerIds.names?.length ??
        0;
      unmatchedTotal += Math.max(0, expectedCount - playerIds.length);

      for (const playerId of playerIds) {
        await client.query(
          `INSERT INTO league_rosters (league_team_id, player_id) VALUES ($1, $2)`,
          [teamDbId, playerId],
        );
      }
    }

    await client.query('COMMIT');
    return { leagueDbId, teamCount: league.teams.length, unmatchedPlayerCount: unmatchedTotal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface PowerRankingTeam {
  teamDbId: number;
  externalId: string;
  teamName: string;
  ownerName: string | null;
  totalValue: number;
  rosterSize: number;
  topPlayers: Array<{ id: number; name: string; rank: number; value: number }>;
}

/** Compute the league power rankings from stored rosters + consensus values. */
export async function computePowerRankings(leagueDbId: number): Promise<PowerRankingTeam[]> {
  // Fetch every team's roster with each player's consensus value
  const rows = await query<{
    team_db_id: number;
    external_id: string;
    team_name: string;
    owner_name: string | null;
    player_id: number;
    player_name: string;
    rank: number | null;
    value: number | null;
  }>(`
    SELECT
      lt.id AS team_db_id,
      lt.external_id,
      lt.team_name,
      lt.owner_name,
      p.id AS player_id,
      p.full_name AS player_name,
      cr.rank,
      cr.value
    FROM league_teams lt
    LEFT JOIN league_rosters lr ON lr.league_team_id = lt.id
    LEFT JOIN players p ON p.id = lr.player_id
    LEFT JOIN consensus_rankings cr ON cr.player_id = p.id
    WHERE lt.league_id = $1
    ORDER BY lt.id, cr.rank NULLS LAST
  `, [leagueDbId]);

  const byTeam = new Map<number, PowerRankingTeam>();
  for (const r of rows) {
    let team = byTeam.get(r.team_db_id);
    if (!team) {
      team = {
        teamDbId: r.team_db_id,
        externalId: r.external_id,
        teamName: r.team_name,
        ownerName: r.owner_name,
        totalValue: 0,
        rosterSize: 0,
        topPlayers: [],
      };
      byTeam.set(r.team_db_id, team);
    }
    if (r.player_id) {
      team.rosterSize += 1;
      const value = r.value ?? 0;
      team.totalValue += value;
      if (team.topPlayers.length < 5) {
        team.topPlayers.push({
          id: r.player_id,
          name: r.player_name,
          rank: r.rank ?? 999,
          value,
        });
      }
    }
  }

  return Array.from(byTeam.values()).sort((a, b) => b.totalValue - a.totalValue);
}
