/**
 * Seed the players table from Sleeper's free public player dump.
 *
 * Sleeper returns ~5MB of player metadata including names, teams, ages,
 * positions, and (critically) ESPN player IDs. We can use this as the
 * canonical player table and join everything else against it.
 *
 * Run: npm run seed-players
 */

import 'dotenv/config';
import { request } from 'undici';
import { pool, query } from '../db/pool';
import { normalizeName } from '../lib/names';

interface SleeperPlayer {
  player_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  team?: string;          // NBA team abbrev
  position?: string;
  fantasy_positions?: string[];
  age?: number;
  espn_id?: number;       // cross-platform ID for ESPN
  yahoo_id?: number;
  status?: string;
  active?: boolean;
}

async function fetchSleeperPlayers(): Promise<Record<string, SleeperPlayer>> {
  console.log('Fetching player list from Sleeper…');
  const { body } = await request('https://api.sleeper.app/v1/players/nba', {
    headersTimeout: 60_000,
    bodyTimeout: 60_000,
  });
  const data = (await body.json()) as Record<string, SleeperPlayer>;
  console.log(`Got ${Object.keys(data).length} player records.`);
  return data;
}

async function seedPlayers() {
  const data = await fetchSleeperPlayers();
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const [sleeperId, p] of Object.entries(data)) {
      // Skip retired / non-active players unless they have a team
      if (!p.full_name && !p.first_name && !p.last_name) continue;
      const fullName = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
      if (!fullName) continue;

      const normalized = normalizeName(fullName);
      if (!normalized) continue;

      // Determine position group
      let position: string | null = null;
      const pos = p.fantasy_positions?.[0] || p.position;
      if (pos) {
        if (['PG', 'SG'].includes(pos)) position = 'G';
        else if (['SF', 'PF'].includes(pos)) position = 'F';
        else if (pos === 'C') position = 'C';
        else position = pos;
      }

      const result = await client.query(
        `
        INSERT INTO players
          (full_name, normalized_name, first_name, last_name, team, position, age, sleeper_id, espn_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (normalized_name) DO UPDATE SET
          team        = COALESCE(EXCLUDED.team, players.team),
          position    = COALESCE(EXCLUDED.position, players.position),
          age         = COALESCE(EXCLUDED.age, players.age),
          sleeper_id  = COALESCE(EXCLUDED.sleeper_id, players.sleeper_id),
          espn_id     = COALESCE(EXCLUDED.espn_id, players.espn_id),
          updated_at  = NOW()
        RETURNING (xmax = 0) AS inserted
        `,
        [
          fullName,
          normalized,
          p.first_name ?? null,
          p.last_name ?? null,
          p.team ?? null,
          position,
          p.age ?? null,
          sleeperId,
          p.espn_id ? String(p.espn_id) : null,
        ],
      );
      if (result.rows[0]?.inserted) inserted++;
      else updated++;
    }

    await client.query('COMMIT');
    console.log(`Seeded players: ${inserted} inserted, ${updated} updated.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Sanity check
  const [{ count }] = await query<{ count: string }>('SELECT COUNT(*) FROM players');
  console.log(`Total players in DB: ${count}`);
}

seedPlayers()
  .catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
