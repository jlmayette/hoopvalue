/**
 * Converts a consensus rank to a 0-10000 dynasty value.
 * Logarithmic decay — the gap between #1 and #10 is much bigger than #50 and #60.
 * We use ln(rank+1)/ln(MAX+1) so rank 1 doesn't divide by zero.
 */
const VALUE_MAX = 10000;
const RANK_CEILING = 250;  // anyone outside top 250 gets ~0

export function rankToValue(rank: number): number {
  if (rank < 1) return VALUE_MAX;
  if (rank >= RANK_CEILING) return 0;
  const decay = 1 - Math.log(rank) / Math.log(RANK_CEILING);
  return Math.max(0, Math.round(VALUE_MAX * decay));
}

/**
 * Compute consensus from a player's ranks across multiple sources.
 * - Drop highest and lowest (trim outliers) if we have ≥5 sources
 * - Weight each source by its recency weight (from ranking_sources.weight)
 * - Return weighted-average rank + stddev for disagreement signal
 */
export interface SourceRank {
  rank: number;
  weight: number;   // 0..1
}

export interface ConsensusResult {
  rank: number;
  stddev: number;
  numSources: number;
}

export function computeConsensus(sourceRanks: SourceRank[]): ConsensusResult | null {
  if (sourceRanks.length === 0) return null;

  let ranks = [...sourceRanks];

  // Trim if we have enough sources
  if (ranks.length >= 5) {
    ranks.sort((a, b) => a.rank - b.rank);
    ranks = ranks.slice(1, -1);
  }

  // Weighted average
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of ranks) {
    weightedSum += r.rank * r.weight;
    totalWeight += r.weight;
  }
  if (totalWeight === 0) return null;

  const meanRank = weightedSum / totalWeight;

  // Standard deviation across raw (unweighted) ranks
  const justRanks = sourceRanks.map(r => r.rank);
  const mean = justRanks.reduce((a, b) => a + b, 0) / justRanks.length;
  const variance = justRanks.reduce((sum, r) => sum + (r - mean) ** 2, 0) / justRanks.length;
  const stddev = Math.sqrt(variance);

  return {
    rank: Math.round(meanRank),
    stddev,
    numSources: sourceRanks.length,
  };
}
