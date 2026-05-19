/**
 * Scrapes RotoBaller's dynasty rankings article.
 * Format: numbered headings like "1. Victor Wembanyama (SAS, C)" inside the body.
 *
 * Their HTML structure has rankings in either tables OR as bold/strong tags
 * inside paragraphs. We try both shapes.
 *
 * NOTE: This URL points to the March 2026 article. New monthly updates
 * publish at different slugs — the article-listing page can be scraped
 * for the latest URL if needed.
 */

import { fetchHTML, persistRankings, ScrapedRanking } from './common';

const URL =
  'https://www.rotoballer.com/fantasy-basketball-dynasty-rankings-march-2026/1831700';

// Match patterns like "1. Player Name", "1) Player Name", "Rank 1: Player Name"
const RANK_LINE_RE = /^\s*(\d{1,3})[.)]\s+([A-Z][A-Za-z'\u00C0-\u017F.\s-]+?)(?:\s*[(,]|\s*$)/;

export async function scrapeRotoBaller() {
  const $ = await fetchHTML(URL);
  const rankings: ScrapedRanking[] = [];

  // First, try the table-based shape (some RotoBaller articles use this)
  $('table').each((_, tbl) => {
    $(tbl).find('tr').each((_, row) => {
      const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
      if (cells.length < 2) return;
      const rank = parseInt(cells[0], 10);
      if (!Number.isFinite(rank)) return;
      rankings.push({ rank, name: cells[1] });
    });
  });

  // If no table found, parse the body text for numbered lines
  if (rankings.length === 0) {
    const articleText = $('.article-body, .entry-content, article')
      .first()
      .text();
    for (const line of articleText.split('\n')) {
      const m = line.match(RANK_LINE_RE);
      if (m) {
        const rank = parseInt(m[1], 10);
        const name = m[2].trim();
        // Sanity: rankings are 1-300, names have ≥2 words usually
        if (rank > 0 && rank <= 300 && name.length > 3) {
          rankings.push({ rank, name });
        }
      }
    }
  }

  console.log(`[rotoballer] scraped ${rankings.length} rankings`);
  return persistRankings('rotoballer', rankings);
}
