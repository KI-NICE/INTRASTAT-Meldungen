import * as mammoth from 'mammoth'
import type { ProductWeightEntry } from '../types'

/**
 * Liest die Word-Datei "Gewichtsliste" ein und liefert eine Liste aus
 * Produktname + Einzelgewicht (in Gramm, je Stück – siehe Konzept Abschnitt 1,
 * Frage 2). Die Datei enthält tabulator-separierte Zeilen der Form
 * "Produkt \t Gewicht \t Zusatz".
 */
export async function parseWeightListDocx(file: File | ArrayBuffer): Promise<ProductWeightEntry[]> {
  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return parseWeightListText(result.value)
}

export function parseWeightListText(rawText: string): ProductWeightEntry[] {
  const lines = rawText.split(/\r?\n/)
  const entries: ProductWeightEntry[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    // Kopf-/Legendenzeile überspringen
    if (/^produkt\b/i.test(line.trim())) continue

    // Zeile in nicht-leere, tab- oder mehrfach-leerzeichen-getrennte Felder zerlegen
    const fields = line
      .split(/\t+| {2,}/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0)

    if (fields.length < 2) continue

    const weightFieldIndex = fields.findIndex((f) => /\d/.test(f) && /g\b/i.test(f))
    if (weightFieldIndex === -1) continue

    const name = fields.slice(0, weightFieldIndex).join(' ').trim()
    const weightField = fields[weightFieldIndex]
    const zusatz = fields.slice(weightFieldIndex + 1).join(' ').trim() || undefined

    const match = weightField.match(/([0-9]+(?:[.,][0-9]+)?)\s*g\b/i)
    if (!match || !name) continue

    const grams = Number(match[1].replace(',', '.'))
    if (Number.isNaN(grams)) continue

    entries.push({ name, unitWeightGrams: grams, zusatz })
  }

  return entries
}
