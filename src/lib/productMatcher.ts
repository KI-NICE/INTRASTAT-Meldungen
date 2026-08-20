import type { ProductMatch, ProductWeightEntry } from '../types'
import { loadManualMappings, normalizeProductName } from './mappingStore'

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j

  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = temp
    }
  }
  return dp[n]
}

function similarity(a: string, b: string): number {
  const dist = levenshtein(a, b)
  const maxLen = Math.max(a.length, b.length, 1)
  return 1 - dist / maxLen
}

const SUGGESTION_THRESHOLD = 0.6
const MAX_SUGGESTIONS = 5

/**
 * Ordnet eine Rechnungs-Produktbezeichnung einem Eintrag der Gewichtsliste zu.
 * Reihenfolge gemäß Anforderung Abschnitt 5:
 *  1. exakte Zuordnung
 *  2. normalisierte Zuordnung (trim, Groß/Klein, Mehrfach-Leerzeichen)
 *  3. zuvor manuell bestätigte Zuordnung (aus lokalem Speicher bzw. aktuellem Lauf)
 *  4. ansonsten nur Vorschläge (nie automatisch übernehmen)
 */
export function matchProduct(
  productNameRaw: string,
  weightList: ProductWeightEntry[],
  sessionMappings: Record<string, ProductWeightEntry> = {},
): ProductMatch {
  const exact = weightList.find((e) => e.name === productNameRaw)
  if (exact) {
    return { matchType: 'exact', entry: exact, suggestions: [] }
  }

  const normalizedTarget = normalizeProductName(productNameRaw)
  const normalizedMatch = weightList.find((e) => normalizeProductName(e.name) === normalizedTarget)
  if (normalizedMatch) {
    return { matchType: 'normalized', entry: normalizedMatch, suggestions: [] }
  }

  const sessionMatch = sessionMappings[normalizedTarget]
  if (sessionMatch) {
    return { matchType: 'manual', entry: sessionMatch, suggestions: [] }
  }

  const persisted = loadManualMappings()[normalizedTarget]
  if (persisted) {
    return { matchType: 'manual', entry: persisted, suggestions: [] }
  }

  const suggestions = weightList
    .map((entry) => ({ entry, score: similarity(normalizedTarget, normalizeProductName(entry.name)) }))
    .filter((s) => s.score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)

  return { matchType: 'none', entry: null, suggestions }
}
