/**
 * Hashtag Basketball dynasty rankings.
 *
 * Their rankings page (https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings)
 * blocks bots aggressively — returns 403 to most user-agents.
 *
 * Strategy:
 *  1. Try fetching the page anyway with a browser-like UA
 *  2. If we get a 403, log it and return empty rankings (no fail)
 *
 * If you want to support Hashtag in production, two options:
 *   - Use a headless-browser service (Browserless, ScrapingBee) ~$10-30/mo
 *   - Manually paste their CSV into the database weekly
 *
 * This scraper writes nothing on failure — the rest of the system runs fine.
 */

import { request } from 'undici';
import * as cheerio from 'cheerio';
import { persistRankings, ScrapedRanking } from './common';

const URL = 'https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings';

export async function scrapeHashtag() {
  try {
    const { body, statusCode } = await request(URL, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'accept-language': 'en-US,en;q=0.9',
      },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });

    if (statusCode === 403) {
      console.warn('[hashtag] blocked (403). Skipping — no rankings written.');
      return persistRankings('hashtag', []);
    }
    if (statusCode >= 400) {
      console.warn(`[hashtag] HTTP ${statusCode}. Skipping.`);
      return persistRankings('hashtag', []);
    }

    const html = await body.text();
    const $ = cheerio.load(html);
    const rankings: ScrapedRanking[] = [];

    // Try a table with class containing "rank"
    $('table').each((_, tbl) => {
      $(tbl).find('tr').each((_, row) => {
        const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
        if (cells.length < 2) return;
        const rank = parseInt(cells[0], 10);
        if (!Number.isFinite(rank)) return;
        rankings.push({ rank, name: cells[1] });
      });
    });

    console.log(`[hashtag] scraped ${rankings.length} rankings`);
    return persistRankings('hashtag', rankings);
  } catch (err) {
    console.warn(`[hashtag] error: ${(err as Error).message}. Skipping.`);
    return persistRankings('hashtag', []);
  }
}
