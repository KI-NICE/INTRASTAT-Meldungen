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
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
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

const SUGGESTION_THRESHOLD = 0.55
const MAX_SUGGESTIONS = 5

/**
 * Prüft, ob `entryName` ein Präfix von `productName` an einer Wortgrenze ist.
 * Beispiel: "Sprayer K2" ist ein Präfix von "Sprayer K2 rot mit Kappe",
 * aber nicht von "Sprayer K20".
 */
function isPrefixAtWordBoundary(productName: string, entryName: string): boolean {
  if (!productName.startsWith(entryName)) return false
  if (productName.length === entryName.length) return true
  const nextChar = productName[entryName.length]
  // Nach dem Treffer darf kein Buchstabe/keine Ziffer folgen, sonst wäre es
  // ein anderer Artikel (z. B. "Sprayer K2" vs. "Sprayer K20").
  return !/[a-z0-9]/i.test(nextChar)
}

/**
 * Ordnet eine Rechnungs-Produktbezeichnung einem Eintrag der Gewichtsliste zu.
 *
 * Reihenfolge (Anforderung Abschnitt 5):
 *  1. exakte Zuordnung
 *  2. normalisierte Zuordnung (trim, Groß-/Kleinschreibung, Mehrfach-Leerzeichen)
 *  3. zuvor manuell bestätigte Zuordnung (aktueller Lauf oder dauerhaft gespeichert)
 *  4. eindeutiger Präfix-Treffer an einer Wortgrenze – der längste passende
 *     Eintrag gewinnt, damit z. B. "DPZ Profi 1.5L C+ blau" nicht
 *     versehentlich auf "DPZ Profi 1.5L" abgebildet wird
 *  5. ansonsten nur Vorschläge – niemals automatische Übernahme
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

  // Präfix-Treffer: längster passender Eintrag gewinnt.
  const prefixMatches = weightList
    .filter((entry) => isPrefixAtWordBoundary(normalizedTarget, normalizeProductName(entry.name)))
    .sort((a, b) => b.name.length - a.name.length)

  if (prefixMatches.length > 0) {
    return { matchType: 'prefix', entry: prefixMatches[0], suggestions: [] }
  }

  // Vorschläge: enthaltene Bezeichnungen zuerst, danach ähnliche Bezeichnungen.
  const containedSuggestions = weightList
    .filter((entry) => normalizedTarget.includes(normalizeProductName(entry.name)))
    .map((entry) => ({ entry, score: 0.9 }))

  const fuzzySuggestions = weightList
    .filter((entry) => !containedSuggestions.some((c) => c.entry.name === entry.name))
    .map((entry) => ({ entry, score: similarity(normalizedTarget, normalizeProductName(entry.name)) }))
    .filter((s) => s.score >= SUGGESTION_THRESHOLD)

  const suggestions = [...containedSuggestions, ...fuzzySuggestions]
    .sort((a, b) => b.score - a.score || b.entry.name.length - a.entry.name.length)
    .slice(0, MAX_SUGGESTIONS)

  return { matchType: 'none', entry: null, suggestions }
}
