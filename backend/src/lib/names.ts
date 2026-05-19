/**
 * Player name normalization. This is the hardest problem in the project.
 *
 * Sources disagree on:
 *  - accents: "Jokić" vs "Jokic" vs "Nikola Jokic"
 *  - suffixes: "Jaren Jackson Jr." vs "Jaren Jackson"
 *  - punctuation: "OG Anunoby" vs "O.G. Anunoby"
 *  - middle names: "Karl-Anthony Towns" vs "Karl Anthony Towns"
 *  - alt spellings: "Şengün" vs "Sengun"
 *
 * normalizeName produces a canonical form for lookups.
 * findBestMatch falls back to fuzzy matching for ambiguous cases.
 */

import levenshtein from 'fast-levenshtein';

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

/** Strip accents, lowercase, remove suffixes, collapse whitespace and punctuation. */
export function normalizeName(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFD')           // split accents from letters
    .replace(/[\u0300-\u036f]/g, '')    // strip combining marks
    .toLowerCase();
  s = s.replace(/[.,'`]/g, '');         // strip punctuation
  s = s.replace(/-/g, ' ');             // hyphens become spaces
  // tokenize, drop suffixes
  const tokens = s.split(/\s+/).filter(t => t && !SUFFIXES.has(t));
  return tokens.join(' ').trim();
}

/** Confidence-scored fuzzy match against a list of candidates. */
export function findBestMatch(
  needle: string,
  candidates: { id: number; normalized_name: string; full_name: string }[],
): { id: number; confidence: number; full_name: string } | null {
  const target = normalizeName(needle);
  if (!target) return null;

  // 1) Exact match — always wins
  const exact = candidates.find(c => c.normalized_name === target);
  if (exact) return { id: exact.id, confidence: 1, full_name: exact.full_name };

  // 2) Levenshtein, normalized by length
  let best: { c: typeof candidates[0]; score: number } | null = null;
  for (const c of candidates) {
    const dist = levenshtein.get(target, c.normalized_name);
    const maxLen = Math.max(target.length, c.normalized_name.length);
    if (maxLen === 0) continue;
    const score = 1 - dist / maxLen;
    if (!best || score > best.score) best = { c, score };
  }

  // Only return a fuzzy match if we're reasonably confident.
  if (best && best.score >= 0.85) {
    return { id: best.c.id, confidence: best.score, full_name: best.c.full_name };
  }
  return null;
}
