import type { ProductMatch } from '../types'

/**
 * Kennzeichen für Flaschenartikel. Bei diesen steht das Artikelgewicht in der
 * Produktbeschreibung selbst und wird NICHT über das Artikel-Gewichtsmapping
 * ermittelt.
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
 * Ordnet eine Rechnungsposition einem Gewicht zu – ausschließlich über die
 * fett gesetzte Artikelnummer (`articleNumberRaw`), nicht mehr über die
 * Produktbezeichnung. Die Gewichtsliste (`weightMap`) ist dabei die EINZIGE
 * Quelle für Artikelnummer-Treffer: Eine manuelle Korrektur mit Artikelnummer
 * wird direkt in die Gewichtsliste geschrieben (siehe
 * `App.handleConfirmProductMapping`), sodass ein Wechsel/Zurücksetzen der
 * Gewichtsliste sich hier immer sofort und korrekt auswirkt – es gibt
 * bewusst KEINE separate, davon losgelöste "gelernte Zuordnung" mehr, die
 * einen zurückgesetzten Wert überdauern könnte.
 *
 * Reihenfolge:
 *  0. Gewicht direkt aus der Produktbeschreibung ("Gew.:20 g") – gilt für
 *     Flaschenartikel und hat Vorrang, da es artikelgenau angegeben ist
 *  1. Treffer im aktuell aktiven Artikel-Gewichtsmapping (`weightMap`)
 *  2. ansonsten kein Treffer – das Gewicht muss manuell eingetragen werden
 */
export function matchProductWeight(
  productNameRaw: string,
  articleNumber: string | undefined,
  weightMap: Record<string, number>,
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

  const trimmedArticleNumber = articleNumber?.trim()
  if (trimmedArticleNumber) {
    const grams = weightMap[trimmedArticleNumber]
    if (grams != null) {
      return {
        matchType: 'exact',
        entry: { name: trimmedArticleNumber, unitWeightGrams: grams },
        suggestions: [],
      }
    }
  }

  return { matchType: 'none', entry: null, suggestions: [] }
}
