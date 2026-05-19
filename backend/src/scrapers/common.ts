import { request } from 'undici';
import * as cheerio from 'cheerio';
import { query, pool } from '../db/pool';
import { findBestMatch, normalizeName } from '../lib/names';

export interface ScrapedRanking {
  rank: number;
  name: string;
  team?: string;
  position?: string;
  age?: number;
}

export interface ScrapeResult {
  sourceSlug: string;
  rankings: ScrapedRanking[];
  matched: number;
  unmatched: { rank: number; name: string }[];
}

/** Fetch a URL with a polite user agent. */
export async function fetchHTML(url: string): Promise<cheerio.CheerioAPI> {
  const { body, statusCode } = await request(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; HoopValueBot/0.1; +https://hoopvalue.example/about)',
      'accept': 'text/html,application/xhtml+xml',
    },
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });
  if (statusCode >= 400) {
    throw new Error(`HTTP ${statusCode} fetching ${url}`);
  }
  const html = await body.text();
  return cheerio.load(html);
}

/**
 * Persist a set of scraped rankings to the database.
 * Matches each scraped name to a canonical player and writes source_rankings rows.
 */
export async function persistRankings(
  sourceSlug: string,
  rankings: ScrapedRanking[],
): Promise<ScrapeResult> {
  if (rankings.length === 0) {
    return { sourceSlug, rankings, matched: 0, unmatched: [] };
  }

  // Get the source ID
  const sourceRows = await query<{ id: number }>(
    'SELECT id FROM ranking_sources WHERE slug = $1',
    [sourceSlug],
  );
  if (sourceRows.length === 0) {
    throw new Error(`Unknown source slug: ${sourceSlug}`);
  }
  const sourceId = sourceRows[0].id;

  // Get all players for fuzzy matching
  const candidates = await query<{
    id: number;
    normalized_name: string;
    full_name: string;
  }>('SELECT id, normalized_name, full_name FROM players');

  const client = await pool.connect();
  const unmatched: { rank: number; name: string }[] = [];
  let matched = 0;
  const scrapedAt = new Date();

  try {
    await client.query('BEGIN');

    for (const r of rankings) {
      const match = findBestMatch(r.name, candidates);
      if (!match) {
        unmatched.push({ rank: r.rank, name: r.name });
        continue;
      }
      await client.query(
        `INSERT INTO source_rankings (source_id, player_id, rank, scraped_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_id, player_id, scraped_at) DO UPDATE SET rank = EXCLUDED.rank`,
        [sourceId, match.id, r.rank, scrapedAt],
      );
      matched++;
    }

    await client.query(
      'UPDATE ranking_sources SET last_scraped_at = $1 WHERE id = $2',
      [scrapedAt, sourceId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { sourceSlug, rankings, matched, unmatched };
}
