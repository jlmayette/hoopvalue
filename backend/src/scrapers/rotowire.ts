/**
 * Scrapes RotoWire's annual dynasty rankings article.
 * Format: HTML table with columns Rank | Name | Team | Age | Pos.
 *
 * NOTE: This URL points to the 2025-26 article. RotoWire publishes a new article
 * each season — when they do, update the URL or scrape the article-list page.
 */

import { fetchHTML, persistRankings, ScrapedRanking } from './common';

const URL =
  'https://www.rotowire.com/basketball/article/fantasy-basketball-dynasty-rankings-2025-95326';

export async function scrapeRotoWire() {
  const $ = await fetchHTML(URL);
  const rankings: ScrapedRanking[] = [];

  // The article contains an HTML table. We look for any table whose first
  // header cell is "Rank" — that's our rankings table.
  $('table').each((_, tbl) => {
    const headers = $(tbl).find('thead th, tr:first-child td, tr:first-child th')
      .map((_, h) => $(h).text().trim().toLowerCase()).get();
    if (!headers.some(h => h.startsWith('rank'))) return;

    $(tbl).find('tbody tr, tr').each((_, row) => {
      const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
      if (cells.length < 5) return;
      const rank = parseInt(cells[0], 10);
      if (!Number.isFinite(rank)) return;

      rankings.push({
        rank,
        name: cells[1],
        team: cells[2] || undefined,
        age: cells[3] ? parseInt(cells[3], 10) : undefined,
        position: cells[4] || undefined,
      });
    });
  });

  console.log(`[rotowire] scraped ${rankings.length} rankings`);
  return persistRankings('rotowire', rankings);
}
