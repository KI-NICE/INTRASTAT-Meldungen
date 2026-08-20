import type { ManualProductMapping, ProductWeightEntry } from '../types'

const STORAGE_KEY = 'intrastat-app.manual-product-mapping.v1'

export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function loadManualMappings(): ManualProductMapping {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as ManualProductMapping
  } catch {
    return {}
  }
}

export function saveManualMapping(productNameRaw: string, entry: ProductWeightEntry): void {
  const all = loadManualMappings()
  all[normalizeProductName(productNameRaw)] = entry
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // localStorage evtl. nicht verfügbar (z. B. privater Modus) – Zuordnung
    // gilt dann nur für den aktuellen Durchlauf im Arbeitsspeicher.
  }
}

export function clearManualMappings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignorieren
  }
}
