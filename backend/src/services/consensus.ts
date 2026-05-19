import { query, pool } from '../db/pool';
import { computeConsensus, rankToValue, SourceRank } from '../lib/value';

interface LatestRankRow {
  player_id: number;
  rank: number;
  weight: number;
}

/**
 * Recompute the consensus_rankings table from the latest scraped data.
 * Takes the MOST RECENT scrape from each active source per player.
 */
export async function recomputeConsensus(): Promise<void> {
  // 1. Get the latest rank per (source, player). We use a window function
  //    to pick the most recent scrape per source.
  const rows = await query<LatestRankRow>(`
    SELECT sr.player_id, sr.rank, src.weight
    FROM (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY source_id, player_id ORDER BY scraped_at DESC) AS rn
      FROM source_rankings
    ) sr
    JOIN ranking_sources src ON sr.source_id = src.id
    WHERE sr.rn = 1 AND src.active = TRUE
  `);

  // 2. Group by player
  const byPlayer = new Map<number, SourceRank[]>();
  for (const row of rows) {
    const list = byPlayer.get(row.player_id) ?? [];
    list.push({ rank: row.rank, weight: Number(row.weight) });
    byPlayer.set(row.player_id, list);
  }

  // 3. Compute consensus per player
  type ConsensusRow = {
    player_id: number;
    weighted_rank: number;
    stddev: number;
    num_sources: number;
  };
  const computed: ConsensusRow[] = [];
  for (const [playerId, sourceRanks] of byPlayer.entries()) {
    const result = computeConsensus(sourceRanks);
    if (result) {
      computed.push({
        player_id: playerId,
        weighted_rank: result.rank,
        stddev: result.stddev,
        num_sources: result.numSources,
      });
    }
  }

  // 4. Sort by weighted rank → assign FINAL consensus rank (1, 2, 3, …)
  computed.sort((a, b) => a.weighted_rank - b.weighted_rank);

  // 5. Wipe and rewrite consensus_rankings
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE consensus_rankings');
    for (let i = 0; i < computed.length; i++) {
      const c = computed[i];
      const finalRank = i + 1;
      await client.query(
        `INSERT INTO consensus_rankings
          (player_id, rank, value, num_sources, rank_stddev, computed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [c.player_id, finalRank, rankToValue(finalRank), c.num_sources, c.stddev.toFixed(2)],
      );
    }
    await client.query('COMMIT');
    console.log(`Consensus written: ${computed.length} players ranked.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
