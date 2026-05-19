/**
 * Dynatyze rankings — the closest active KTC-equivalent for basketball.
 *
 * Their page loads rankings via JavaScript (React/Next.js), so a static HTML
 * fetch returns an empty table. To get the data we'd need either:
 *   - Their unofficial JSON API endpoint (if discoverable in their network tab)
 *   - A headless browser to execute the JS
 *
 * For now this is a stub that logs a TODO and returns empty.
 * Replace `dynamicFetch` below with a real implementation when you have
 * either an API key from them or a headless browser service set up.
 */

import { persistRankings } from './common';

export async function scrapeDynatyze() {
  console.warn(
    '[dynatyze] not implemented — page is JS-rendered. ' +
    'See src/scrapers/dynatyze.ts for instructions to enable.',
  );
  return persistRankings('dynatyze', []);
}

/*
HOW TO ENABLE DYNATYZE INGESTION:

Option A — Find their JSON API:
  Open Dynatyze in Chrome, open DevTools → Network tab,
  filter to "fetch/xhr", reload the rankings page.
  Look for a request to something like /api/v1/rankings or /api/rankings.
  Copy that URL and the request headers; replace the body of this function
  with a fetch to that URL.

Option B — Headless browser (Browserless.io free tier):
  npm install puppeteer-core
  Sign up at browserless.io, get an API key.
  Replace this function with:

  import puppeteer from 'puppeteer-core';
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`,
  });
  const page = await browser.newPage();
  await page.goto('https://dynatyze.com/dynasty-basketball-rankings');
  await page.waitForSelector('table tr');
  const rows = await page.$$eval('table tr', trs => trs.map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim())
  ));
  // parse rows...
  await browser.close();

Option C — Manual weekly upload:
  Add a small admin endpoint that accepts CSV upload (POST /admin/upload-rankings)
  and reuses persistRankings(). Then paste their data once a week.
*/
