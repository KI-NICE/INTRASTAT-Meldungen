import type { ProductMatch, ProductWeightEntry } from '../types'
import { loadManualMappings, normalizeProductName } from './mappingStore'

/**
 * Normalisiert eine Produktbezeichnung für den Abgleich mit der
 * Gewichtsliste. Ziel ist, dieselbe Schreibweise aus Rechnung und
 * Gewichtsliste vergleichbar zu machen:
 *
 *  - Groß-/Kleinschreibung und Mehrfach-Leerzeichen vereinheitlichen
 *  - Dezimalkomma in Zahlen zu Punkt ("1,0 L" → "1.0 l")
 *  - Zahl und Einheit zusammenziehen ("1.0 l" → "1.0l", "15 cm" → "15cm"),
 *    damit "DPZ Hobby 1,0 L" und "DPZ Hobby 1.0L" identisch werden
 */
export function normalizeForMatch(value: string): string {
  return value
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s+(l|ml|cl|cm|mm|g|kg)\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string): string[] {
  return normalizeForMatch(value)
    .split(' ')
    .map((token) => token.replace(/[,;:]+$/, ''))
    .filter((token) => token.length > 0)
}

/**
 * Prüft, ob die Tokenfolge des Gewichtslisten-Eintrags ein Anfang der
 * Tokenfolge der Rechnungsbezeichnung ist.
 *
 * Der Vergleich erfolgt tokenweise (nicht zeichenweise), damit
 * "Sprayer K2" NICHT auf "Sprayer K20 spezial" passt, "Sprayer K2" aber
 * sehr wohl auf "Sprayer K2 rot mit Kappe".
 */
function isTokenPrefix(invoiceTokens: string[], entryTokens: string[]): boolean {
  if (entryTokens.length === 0 || entryTokens.length > invoiceTokens.length) return false
  return entryTokens.every((token, index) => invoiceTokens[index] === token)
}

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
  return 1 - dist / Math.max(a.length, b.length, 1)
}

const SUGGESTION_THRESHOLD = 0.55
const MAX_SUGGESTIONS = 5

/* ------------------------------------------- Gewicht aus der Produktbeschreibung */

/**
 * Kennzeichen für Flaschenartikel. Bei diesen steht das Artikelgewicht in der
 * Produktbeschreibung selbst und wird NICHT über die Gewichtsliste ermittelt.
 */
const BOTTLE_KEYWORDS = /(Zylinderflasche|Zylk\.?|Zyl\.|Vierkant|\bVK\b|\bFL\b)/i

const DESCRIPTION_WEIGHT_PATTERN =
  /(?:Gew(?:icht)?\s*\.?|Weight|Wgt\.?)\s*:?\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|gr?)\b/i

export type DescriptionWeight = { grams: number; raw: string; isBottleArticle: boolean }

/**
 * Liest ein in der Produktbeschreibung angegebenes Artikelgewicht,
 * z. B. "Zyl.Flasche 250ml Gew.:20 g".
 */
export function extractWeightFromDescription(description: string): DescriptionWeight | null {
  const match = description.match(DESCRIPTION_WEIGHT_PATTERN)
  if (!match) return null

  const value = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null

  const unit = match[2].toLowerCase()
  const grams = unit === 'kg' ? value * 1000 : value

  return {
    grams,
    raw: match[0].trim(),
    isBottleArticle: BOTTLE_KEYWORDS.test(description),
  }
}

/* --------------------------------------------------------------- Zuordnung */

/**
 * Ordnet eine Rechnungs-Produktbezeichnung einem Gewicht zu.
 *
 * Reihenfolge:
 *  0. Gewicht direkt aus der Produktbeschreibung ("Gew.:20 g") – gilt für
 *     Flaschenartikel und hat Vorrang, da es artikelgenau angegeben ist
 *  1. exakte Zuordnung zur Gewichtsliste
 *  2. normalisierte Zuordnung
 *  3. zuvor manuell bestätigte Zuordnung (Sitzung oder dauerhaft gespeichert)
 *  4. eindeutiger Treffer über den Bezeichnungsanfang (tokenweise, längster
 *     Eintrag gewinnt)
 *  5. ansonsten nur Vorschläge – niemals automatische Übernahme
 */
export function matchProduct(
  productNameRaw: string,
  weightList: ProductWeightEntry[],
  sessionMappings: Record<string, ProductWeightEntry> = {},
): ProductMatch {
  const descriptionWeight = extractWeightFromDescription(productNameRaw)
  if (descriptionWeight) {
    return {
      matchType: 'beschreibung',
      entry: {
        name: 'Gewicht aus Produktbeschreibung',
        unitWeightGrams: descriptionWeight.grams,
        zusatz: descriptionWeight.raw,
      },
      suggestions: [],
    }
  }

  const exact = weightList.find((e) => e.name === productNameRaw)
  if (exact) return { matchType: 'exact', entry: exact, suggestions: [] }

  const normalizedTarget = normalizeProductName(productNameRaw)

  const normalizedMatch = weightList.find((e) => normalizeProductName(e.name) === normalizedTarget)
  if (normalizedMatch) return { matchType: 'normalized', entry: normalizedMatch, suggestions: [] }

  const sessionMatch = sessionMappings[normalizedTarget]
  if (sessionMatch) return { matchType: 'manual', entry: sessionMatch, suggestions: [] }

  const persisted = loadManualMappings()[normalizedTarget]
  if (persisted) return { matchType: 'manual', entry: persisted, suggestions: [] }

  // Tokenweiser Präfix-Treffer; der längste passende Eintrag gewinnt.
  const invoiceTokens = tokenize(productNameRaw)
  const prefixMatches = weightList
    .map((entry) => ({ entry, tokens: tokenize(entry.name) }))
    .filter(({ tokens }) => isTokenPrefix(invoiceTokens, tokens))
    .sort((a, b) => b.tokens.length - a.tokens.length || b.entry.name.length - a.entry.name.length)

  if (prefixMatches.length > 0) {
    return { matchType: 'prefix', entry: prefixMatches[0].entry, suggestions: [] }
  }

  // Vorschläge: enthaltene Bezeichnungen zuerst, danach ähnliche.
  const normalizedForFuzzy = normalizeForMatch(productNameRaw)
  const contained = weightList
    .filter((entry) => normalizedForFuzzy.includes(normalizeForMatch(entry.name)))
    .map((entry) => ({ entry, score: 0.9 }))

  const fuzzy = weightList
    .filter((entry) => !contained.some((c) => c.entry.name === entry.name))
    .map((entry) => ({ entry, score: similarity(normalizedForFuzzy, normalizeForMatch(entry.name)) }))
    .filter((s) => s.score >= SUGGESTION_THRESHOLD)

  const suggestions = [...contained, ...fuzzy]
    .sort((a, b) => b.score - a.score || b.entry.name.length - a.entry.name.length)
    .slice(0, MAX_SUGGESTIONS)

  return { matchType: 'none', entry: null, suggestions }
}
