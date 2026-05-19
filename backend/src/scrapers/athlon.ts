/**
 * Athlon Sports — 2026 NBA Draft fantasy rookie rankings.
 * This source provides ranking input for rookies only.
 * Format: numbered list in article body.
 */

import { fetchHTML, persistRankings, ScrapedRanking } from './common';

const URL = 'https://athlonsports.com/fantasy/2026-nba-draft-fantasy-rookie-rankings';
const RANK_RE = /^\s*(\d{1,2})\.\s+([A-Z][A-Za-z'\u00C0-\u017F.\s-]+)/;

export async function scrapeAthlon() {
  const $ = await fetchHTML(URL);
  const rankings: ScrapedRanking[] = [];

  // Try h2/h3 headings first (Athlon typically uses those for rankings)
  $('h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    const m = text.match(RANK_RE);
    if (m) {
      const rank = parseInt(m[1], 10);
      const name = m[2].trim();
      if (rank > 0 && rank <= 50 && name.length > 3) {
        rankings.push({ rank, name });
      }
    }
  });

  // Fallback: paragraph text
  if (rankings.length === 0) {
    $('article p, .entry-content p').each((_, el) => {
      const text = $(el).text().trim();
      const m = text.match(RANK_RE);
      if (m) {
        const rank = parseInt(m[1], 10);
        const name = m[2].trim();
        if (rank > 0 && rank <= 50) rankings.push({ rank, name });
      }
    });
  }

  console.log(`[athlon] scraped ${rankings.length} rankings`);
  return persistRankings('athlon', rankings);
}
