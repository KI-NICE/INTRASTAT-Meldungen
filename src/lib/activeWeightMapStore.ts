/**
 * Der aktuell aktive Artikel-Gewichtsmapping-Stand je Firma und Richtung
 * (AR/ER) wird hier fortlaufend in localStorage gespiegelt. Ohne dies gingen
 * einzelne, in der Prüfansicht manuell bestätigte Artikelgewichte (siehe
 * App.handleConfirmProductMapping) verloren, sobald die Seite neu geladen
 * wird (z. B. bei einem Neustart des lokalen Entwicklungsservers) – anders
 * als ein kompletter Listen-Upload wurden sie bisher nirgends dauerhaft
 * gemerkt (siehe weightListHistory.ts, das nur komplette Ersetzungen
 * aufzeichnet).
 *
 * Beide Firmen führen fachlich getrennte Artikel-Kataloge, daher ist der
 * Speicherschlüssel zusätzlich zur Richtung auch nach Firma getrennt.
 */
import type { Company, InvoiceDirection } from '../types'

function storageKey(company: Company, direction: InvoiceDirection): string {
  return `intrastat-app.weightmap.active.v1.${company}.${direction}`
}

export type ActiveWeightMap = {
  entries: Record<string, number>
  stand: string
}

export function loadActiveWeightMap(company: Company, direction: InvoiceDirection): ActiveWeightMap | null {
  try {
    const raw = localStorage.getItem(storageKey(company, direction))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') return null
    return { entries: parsed.entries ?? {}, stand: typeof parsed.stand === 'string' ? parsed.stand : '' }
  } catch {
    return null
  }
}

export function saveActiveWeightMap(
  company: Company,
  direction: InvoiceDirection,
  entries: Record<string, number>,
  stand: string,
): void {
  try {
    localStorage.setItem(storageKey(company, direction), JSON.stringify({ entries, stand }))
  } catch {
    // localStorage evtl. nicht verfügbar – der Stand gilt dann nur für die
    // laufende Sitzung im Arbeitsspeicher.
  }
}
