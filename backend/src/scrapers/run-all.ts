import 'dotenv/config';
import { pool } from '../db/pool';
import { scrapeRotoWire } from './rotowire';
import { scrapeRotoBaller } from './rotoballer';
import { scrapeAngle } from './angle';
import { scrapeAthlon } from './athlon';
import { scrapeHashtag } from './hashtag';
import { scrapeDynatyze } from './dynatyze';
import { recomputeConsensus } from '../services/consensus';

const SCRAPERS = [
  { name: 'rotowire',   fn: scrapeRotoWire },
  { name: 'rotoballer', fn: scrapeRotoBaller },
  { name: 'angle',      fn: scrapeAngle },
  { name: 'athlon',     fn: scrapeAthlon },
  { name: 'hashtag',    fn: scrapeHashtag },
  { name: 'dynatyze',   fn: scrapeDynatyze },
];

export async function runAllScrapers() {
  const summary: any[] = [];
  for (const s of SCRAPERS) {
    try {
      const start = Date.now();
      const result = await s.fn();
      const elapsed = Date.now() - start;
      console.log(
        `✓ ${s.name}: ${result.rankings.length} scraped, ` +
        `${result.matched} matched, ${result.unmatched.length} unmatched ` +
        `(${elapsed}ms)`,
      );
      summary.push({ source: s.name, ok: true, ...result, ms: elapsed });
    } catch (err) {
      console.error(`✗ ${s.name} failed:`, (err as Error).message);
      summary.push({ source: s.name, ok: false, error: (err as Error).message });
    }
  }
  console.log('\nRecomputing consensus rankings…');
  await recomputeConsensus();
  console.log('Done.');
  return summary;
}

// Run directly if invoked via `npm run scrape`
if (require.main === module) {
  runAllScrapers()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => pool.end());
}
