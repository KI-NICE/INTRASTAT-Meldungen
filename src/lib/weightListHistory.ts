/**
 * Verlauf der zuletzt hochgeladenen Artikel-Gewichtsmappings – getrennt nach
 * Firma sowie nach Ausgangs- (AR) und Eingangsrechnungen (ER), da jede Firma
 * und Richtung eine eigenständige Gewichtsliste führt (siehe
 * mappingStore.ts). Jede erfolgreiche Ersetzung wird hier zwischengespeichert,
 * damit man später ohne erneuten Upload zu einem früheren Stand zurückkehren
 * kann ("Aktuelle Gewichtsliste zurücksetzen"). Es werden je Firma/Richtung
 * höchstens die letzten 5 Stände aufbewahrt – bei einer neuen Version wird
 * der jeweils älteste Eintrag verworfen.
 */
import type { Company, InvoiceDirection } from '../types'

const MAX_HISTORY = 5

function storageKey(company: Company, direction: InvoiceDirection): string {
  return `intrastat-app.weightlist-history.v3.${company}.${direction}`
}

export type WeightListVersion = {
  id: string
  /** Artikelnummer → Gewicht je Stück in Gramm. */
  entries: Record<string, number>
  /** Zeitpunkt der Ersetzung (Epoch-Millisekunden). */
  savedAt: number
  sourceFileName?: string
}

function readHistory(company: Company, direction: InvoiceDirection): WeightListVersion[] {
  try {
    const raw = localStorage.getItem(storageKey(company, direction))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeHistory(company: Company, direction: InvoiceDirection, history: WeightListVersion[]): void {
  try {
    localStorage.setItem(storageKey(company, direction), JSON.stringify(history))
  } catch {
    // localStorage evtl. nicht verfügbar – der Verlauf gilt dann nur für die
    // laufende Sitzung im Arbeitsspeicher.
  }
}

/** Liefert den Verlauf einer Firma/Richtung, neueste Version zuerst. */
export function loadWeightListHistory(company: Company, direction: InvoiceDirection): WeightListVersion[] {
  return readHistory(company, direction)
}

/**
 * Merkt sich eine neue Artikel-Gewichtsmapping-Version für eine Firma/
 * Richtung. Die neue Version steht danach an erster Stelle; überschreitet
 * der Verlauf 5 Einträge, wird der älteste entfernt.
 */
export function saveWeightListVersion(
  company: Company,
  direction: InvoiceDirection,
  entries: Record<string, number>,
  sourceFileName?: string,
): WeightListVersion {
  const version: WeightListVersion = {
    id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entries,
    savedAt: Date.now(),
    sourceFileName,
  }
  const history = [version, ...readHistory(company, direction)].slice(0, MAX_HISTORY)
  writeHistory(company, direction, history)
  return version
}

export function clearWeightListHistory(company: Company, direction: InvoiceDirection): void {
  try {
    localStorage.removeItem(storageKey(company, direction))
  } catch {
    // ignorieren
  }
}
