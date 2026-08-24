/**
 * Hilfsfunktionen für das deutsche Zahlenformat (#.###,##) sowie Rundungen
 * gemäß den fachlichen Vorgaben (Abschnitt 4 der Anforderungen).
 */

/**
 * Parst eine Zahl im deutschen Format, z. B. "1.234,56", "127", "1.234,56 EUR",
 * "1.234,56 kg". Gibt null zurück, wenn der String nicht eindeutig als Zahl
 * interpretiert werden kann (dann darf NICHT geraten werden).
 */
export function parseGermanNumber(input: string | undefined | null): number | null {
  if (input == null) return null
  let s = input.trim()
  if (s === '') return null

  // Einheiten/Währungssymbole entfernen
  s = s.replace(/EUR|€|kg|Stk\.?|Stück/gi, '').trim()

  // Vorzeichen erkennen
  let negative = false
  if (/^-/.test(s) || /^\(.*\)$/.test(s)) {
    negative = true
    s = s.replace(/^-/, '').replace(/^\(/, '').replace(/\)$/, '')
  }

  // Nur gültige Zeichen erlauben: Ziffern, Punkt, Komma, Leerzeichen (als Tausendertrennzeichen selten)
  if (!/^[0-9.,\s]+$/.test(s)) return null

  s = s.replace(/\s/g, '')

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  let normalized: string
  if (hasComma && hasDot) {
    // Deutsches Format: Punkt = Tausender, Komma = Dezimaltrennzeichen
    if (s.lastIndexOf(',') < s.lastIndexOf('.')) {
      // unplausibel für deutsches Format (Komma vor Punkt) -> nicht eindeutig
      return null
    }
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (hasComma && !hasDot) {
    // "1234,56" -> Komma ist Dezimaltrennzeichen
    normalized = s.replace(',', '.')
  } else if (!hasComma && hasDot) {
    // Könnte "1.234" (Tausender) oder "1.5" (unklar) sein.
    // Heuristik: genau 3 Nachkommastellen nach dem letzten Punkt und mehr als
    // eine Zifferngruppe -> Tausendertrennzeichen. Sonst als Dezimalzahl lesen.
    const parts = s.split('.')
    const last = parts[parts.length - 1]
    if (parts.length > 1 && last.length === 3 && parts.slice(0, -1).every((p) => p.length <= 3)) {
      normalized = s.replace(/\./g, '')
    } else {
      normalized = s
    }
  } else {
    normalized = s
  }

  const value = Number(normalized)
  if (Number.isNaN(value)) return null
  return negative ? -value : value
}

/** Formatiert eine Zahl mit Tausenderpunkt und Komma (rein zur Anzeige). */
export function formatGermanNumber(value: number, fractionDigits = 2): string {
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/** Rundet immer auf die nächste ganze Zahl auf (auch bei bereits ganzen Zahlen unverändert). */
export function roundUp(value: number): number {
  // Fließkomma-Ungenauigkeiten (z. B. 3.0000000001) abfangen
  const rounded = Math.round(value * 1e6) / 1e6
  return Math.ceil(rounded)
}

/** Kaufmännisches Runden auf ganze Zahlen. */
export function roundCommercial(value: number): number {
  return Math.round(value)
}

/** Formatiert ein Datum als "TT.MM.JJJJ" (z. B. für den Datenstand hinterlegter Dateien). */
export function formatGermanDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}
