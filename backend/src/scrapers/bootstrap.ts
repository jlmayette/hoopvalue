import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool, query } from '../db/pool';
import { runAllScrapers } from './run-all';
 
/**
* Run migrations + player seed + initial scrape if the database is empty.
* Idempotent: only runs the heavy work if there are zero players in the DB.
*/
export async function bootstrapIfNeeded(): Promise<void> {
  console.log('[bootstrap] Checking database state…');
 
  // Step 1: always run migrations (CREATE TABLE IF NOT EXISTS is idempotent)
  await runMigrations();

  // Step 2: check player count
  const rows = await query<{ count: string }>('SELECT COUNT(*) FROM players');
  const playerCount = parseInt(rows[0].count, 10);

  if (playerCount > 0) {
    console.log(`[bootstrap] DB already populated (${playerCount} players). Skipping seed + scrape.`);
    return;
  }
 
  console.log('[bootstrap] Empty DB detected. Running first-time seed + scrape…');
 
  // Step 3: seed players (inlined here to avoid main script side effects)
  await seedPlayersInline();
 
  // Step 4: scrape and compute consensus
  await runAllScrapers();
 
  console.log('[bootstrap] Done.');
}
 
async function runMigrations(): Promise<void> {
  const dir = join(__dirname, '..', '..', 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    console.log(`[bootstrap] Running migration ${file}…`);
    const sql = readFileSync(join(dir, file), 'utf8');
    await pool.query(sql);
  }
}
 
async function seedPlayersInline(): Promise<void> {
  const { request } = await import('undici');
  const { normalizeName } = await import('../lib/names');
 
  console.log('[bootstrap] Fetching player list from Sleeper…');
  const { body } = await request('https://api.sleeper.app/v1/players/nba', {
    headersTimeout: 60_000,
    bodyTimeout: 60_000,
  });
  const data = (await body.json()) as Record<string, any>;
  console.log(`[bootstrap] Got ${Object.keys(data).length} player records.`);
 
  const client = await pool.connect();
  let inserted = 0;
 
  try {
    await client.query('BEGIN');
    for (const [sleeperId, p] of Object.entries(data)) {
      if (!p.full_name && !p.first_name && !p.last_name) continue;
      const fullName = p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
      if (!fullName) continue;
      const normalized = normalizeName(fullName);
      if (!normalized) continue;
 
      let position: string | null = null;
      const pos = p.fantasy_positions?.[0] || p.position;
      if (pos) {
        if (['PG', 'SG'].includes(pos)) position = 'G';
        else if (['SF', 'PF'].includes(pos)) position = 'F';
        else if (pos === 'C') position = 'C';
        else position = pos;
      }
 
      await client.query(
        `INSERT INTO players
          (full_name, normalized_name, first_name, last_name, team, position, age, sleeper_id, espn_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (normalized_name) DO NOTHING`,
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
      inserted++;
    }
    await client.query('COMMIT');
    console.log(`[bootstrap] Seeded ${inserted} players.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
