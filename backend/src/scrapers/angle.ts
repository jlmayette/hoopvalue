/**
 * Angle Fantasy Basketball publishes rankings via embedded Google Sheets.
 *
 * The article HTML contains an iframe like:
 *   https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml?gid=0&single=true
 *
 * We can convert that to a CSV export URL:
 *   https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=0&single=true&output=csv
 *
 * That returns clean CSV — no scraping needed.
 *
 * NOTE: Angle posts a new "Top 300 Dynasty Rankings" article each month.
 * Hard-coding the latest sheet ID; in production, scrape the homepage for
 * the most recent rankings post.
 */

import { request } from 'undici';
import { persistRankings, ScrapedRanking } from './common';

const SHEET_ID =
  '2PACX-1vSJmqF_AOuFGXm5xpL6j6W8VaAyOP6s9-kn7cBTzPM4WTpZV7Q7aqqMp4LnnJas6rPhNzK_hkI-t7pF';
const CSV_URL = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=0&single=true&output=csv`;

function parseCSVLine(line: string): string[] {
  // Simple CSV parser handling quoted fields
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

export async function scrapeAngle() {
  const { body, statusCode } = await request(CSV_URL);
  if (statusCode >= 400) throw new Error(`Angle CSV returned ${statusCode}`);
  const csv = await body.text();

  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return persistRankings('angle', []);

  // Find the header row — looks for "rank" or "rk" in any column
  const headerRow = parseCSVLine(lines[0]).map(c => c.toLowerCase());
  const rankCol = headerRow.findIndex(c => c === 'rank' || c === 'rk' || c === '#');
  const nameCol = headerRow.findIndex(c => c === 'name' || c === 'player');
  const teamCol = headerRow.findIndex(c => c === 'team' || c === 'tm');
  const ageCol  = headerRow.findIndex(c => c === 'age');
  const posCol  = headerRow.findIndex(c => c === 'pos' || c === 'position');

  // Fall back to positional defaults if we can't find headers
  const rankIdx = rankCol >= 0 ? rankCol : 0;
  const nameIdx = nameCol >= 0 ? nameCol : 1;

  const rankings: ScrapedRanking[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.length < 2) continue;
    const rank = parseInt(cells[rankIdx], 10);
    const name = cells[nameIdx];
    if (!Number.isFinite(rank) || !name) continue;
    rankings.push({
      rank,
      name,
      team: teamCol >= 0 ? cells[teamCol] : undefined,
      age: ageCol >= 0 ? parseFloat(cells[ageCol]) : undefined,
      position: posCol >= 0 ? cells[posCol] : undefined,
    });
  }

  console.log(`[angle] scraped ${rankings.length} rankings`);
  return persistRankings('angle', rankings);
}
