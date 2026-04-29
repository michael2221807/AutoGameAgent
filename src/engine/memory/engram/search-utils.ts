/**
 * Search utilities — BM25 and RRF for Engram V2 retrieval.
 *
 * Aligned with Graphiti's search orchestration:
 * - BM25: simplified keyword matching for Chinese text (no IDF — corpus too small)
 * - RRF: Reciprocal Rank Fusion for merging multiple ranked lists
 *
 * Design doc: docs/architecture/engram-v2-graphiti-alignment.md §3.3
 */

/** Tokenize Chinese text into unigrams + bigrams for BM25 matching. */
export function tokenizeChinese(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/\s+/g, '');
  if (!cleaned) return [];

  const tokens: string[] = [];

  // Unigrams (individual CJK characters)
  for (const ch of cleaned) {
    if (ch.charCodeAt(0) >= 0x4e00 && ch.charCodeAt(0) <= 0x9fff) {
      tokens.push(ch);
    }
  }

  // Bigrams (2-char sliding window for CJK)
  for (let i = 0; i < cleaned.length - 1; i++) {
    const c1 = cleaned.charCodeAt(i);
    const c2 = cleaned.charCodeAt(i + 1);
    if (c1 >= 0x4e00 && c1 <= 0x9fff && c2 >= 0x4e00 && c2 <= 0x9fff) {
      tokens.push(cleaned.slice(i, i + 2));
    }
  }

  // Non-CJK words (split by whitespace, already lowercased)
  const nonCjk = text.toLowerCase().split(/[\s\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  tokens.push(...nonCjk);

  return tokens;
}

/**
 * Simplified BM25 score — no IDF (corpus too small for meaningful IDF).
 *
 * Formula: score = Σ tf(t) / (tf(t) + k1) normalized to [0, 1]
 * where k1 = 1.2 (BM25 saturation parameter)
 */
export function bm25Score(query: string, text: string): number {
  const queryTokens = tokenizeChinese(query);
  const textTokens = tokenizeChinese(text);
  if (queryTokens.length === 0 || textTokens.length === 0) return 0;

  const K1 = 1.2;
  let score = 0;
  for (const qt of queryTokens) {
    const tf = textTokens.filter((t) => t === qt).length;
    if (tf > 0) {
      score += tf / (tf + K1);
    }
  }
  return score / queryTokens.length;
}

/**
 * Reciprocal Rank Fusion — merge multiple ranked ID lists into a single scored ranking.
 *
 * Graphiti uses k=1 (not the typical k=60 from the RRF paper).
 * Formula: score(d) = Σ 1/(rank_i + k)
 *
 * @param rankedLists Array of ranked ID arrays (best first). Each list is pre-sorted by its method's score.
 * @param k RRF constant (default 1, matching Graphiti)
 * @returns Map of ID → RRF score, sorted descending
 */
export function rrfMerge(
  rankedLists: string[][],
  k: number = 1,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const rank = i + 1; // 1-based rank (best = 1)
      const prev = scores.get(id) ?? 0;
      scores.set(id, prev + 1 / (rank + k));
    }
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
