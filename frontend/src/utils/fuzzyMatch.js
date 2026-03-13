/**
 * Score how well `query` matches `candidate`.
 * Returns 0 (no match) to 1 (exact match).
 * Checks substring first, then falls back to Levenshtein distance.
 */
export function fuzzyScore(query, candidate) {
  if (!query || !candidate) return 0
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()

  // Exact match
  if (q === c) return 1

  // Substring containment — strong signal
  if (c.includes(q)) return 0.8
  if (q.includes(c)) return 0.6

  // Word overlap — "ground beef" matches "beef, ground"
  const qWords = q.split(/\s+/)
  const cWords = c.split(/\s+/)
  const overlap = qWords.filter(w => cWords.some(cw => cw.includes(w) || w.includes(cw))).length
  if (overlap > 0 && overlap >= qWords.length * 0.5) {
    return 0.4 + (overlap / Math.max(qWords.length, cWords.length)) * 0.3
  }

  // Levenshtein for typo detection (only for similar-length strings)
  if (Math.abs(q.length - c.length) <= 3) {
    const dist = levenshtein(q, c)
    const maxLen = Math.max(q.length, c.length)
    const ratio = 1 - dist / maxLen
    if (ratio >= 0.6) return ratio * 0.5
  }

  return 0
}

/**
 * Filter and rank candidates by match quality against query.
 * Returns top matches above threshold, best first.
 */
export function fuzzyFilter(query, candidates, { exclude = new Set(), limit = 8, threshold = 0.3 } = {}) {
  if (!query || query.trim().length < 1) return []
  const q = query.trim()

  const scored = candidates
    .filter(c => !exclude.has(c.toLowerCase()))
    .map(c => ({ name: c, score: fuzzyScore(q, c) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map(s => s.name)
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}
