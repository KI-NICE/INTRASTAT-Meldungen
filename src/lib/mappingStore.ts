import type { ManualProductMapping, ProductWeightEntry } from '../types'

const PRODUCT_STORAGE_KEY = 'intrastat-app.manual-product-mapping.v1'
const COUNTRY_STORAGE_KEY = 'intrastat-app.manual-country-mapping.v1'

export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeCountryToken(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '')
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage evtl. nicht verfügbar (z. B. privater Modus) – die
    // Zuordnung gilt dann nur für den aktuellen Durchlauf im Arbeitsspeicher.
  }
}

/* ---------------------------------------------------------------- Produkte */

export function loadManualMappings(): ManualProductMapping {
  return readJson<ManualProductMapping>(PRODUCT_STORAGE_KEY, {})
}

export function saveManualMapping(productNameRaw: string, entry: ProductWeightEntry): void {
  const all = loadManualMappings()
  all[normalizeProductName(productNameRaw)] = entry
  writeJson(PRODUCT_STORAGE_KEY, all)
}

export function clearManualMappings(): void {
  try {
    localStorage.removeItem(PRODUCT_STORAGE_KEY)
  } catch {
    // ignorieren
  }
}

/* ------------------------------------------------------------------ Länder */

export type ManualCountryMapping = Record<string, string>

/**
 * Dauerhaft gespeicherte Länder-Zuordnungen. Schlüssel ist das im Adressblock
 * gefundene Token (z. B. ein unbekanntes Kennzeichen oder eine Adresszeile),
 * Wert der bestätigte ISO-Code.
 */
export function loadCountryMappings(): ManualCountryMapping {
  return readJson<ManualCountryMapping>(COUNTRY_STORAGE_KEY, {})
}

export function saveCountryMapping(token: string, isoCode: string): void {
  const all = loadCountryMappings()
  all[normalizeCountryToken(token)] = isoCode
  writeJson(COUNTRY_STORAGE_KEY, all)
}

export function lookupCountryMapping(token: string | null | undefined): string | null {
  if (!token) return null
  return loadCountryMappings()[normalizeCountryToken(token)] ?? null
}

export function clearCountryMappings(): void {
  try {
    localStorage.removeItem(COUNTRY_STORAGE_KEY)
  } catch {
    // ignorieren
  }
}
