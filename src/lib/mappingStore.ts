// v2: Die frühere, namensbasierte Zuordnung (Produktbezeichnung → Gewicht,
// "Gewichtsliste.docx") wurde durch das artikelnummernbasierte
// Artikel-Gewichtsmapping ersetzt. Die separate, davon losgelöste "gelernte
// Artikelnummer-Zuordnung" (v2/er.v1) wurde inzwischen ganz entfernt: Eine
// manuelle Gewichtskorrektur mit Artikelnummer wird seitdem direkt in die
// aktive Gewichtsliste geschrieben (siehe App.handleConfirmProductMapping),
// damit ein späteres Zurücksetzen/Ersetzen der Gewichtsliste nicht mehr von
// einem unabhängig überdauernden Alt-Wert unterlaufen werden kann. Alle
// zugehörigen Alt-Schlüssel werden beim Laden einmalig geräumt.
const LEGACY_PRODUCT_STORAGE_KEY = 'intrastat-app.manual-product-mapping.v1'
const LEGACY_ARTICLE_STORAGE_KEY_V1 = 'intrastat-app.manual-weight-by-article.v1'
const LEGACY_ARTICLE_STORAGE_KEY_V2 = 'intrastat-app.manual-weight-by-article.v2'
const LEGACY_ARTICLE_STORAGE_KEY_ER = 'intrastat-app.manual-weight-by-article.er.v1'
const ADDRESS_STORAGE_KEY = 'intrastat-app.address-country-override.v1'

try {
  localStorage.removeItem(LEGACY_PRODUCT_STORAGE_KEY)
  localStorage.removeItem(LEGACY_ARTICLE_STORAGE_KEY_V1)
  localStorage.removeItem(LEGACY_ARTICLE_STORAGE_KEY_V2)
  localStorage.removeItem(LEGACY_ARTICLE_STORAGE_KEY_ER)
} catch {
  // localStorage evtl. nicht verfügbar – nichts zu räumen
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

/* ------------------------------------------- gelernte Adress-Zuordnungen */

export function clearCountryMappings(): void {
  try {
    localStorage.removeItem(ADDRESS_STORAGE_KEY)
  } catch {
    // ignorieren
  }
}

/**
 * Erzeugt einen stabilen Schlüssel für einen Adressblock. Damit lassen sich
 * manuelle Abweichungen adressgenau merken, statt sie pauschal auf ein
 * Länderkennzeichen anzuwenden.
 */
export function addressFingerprint(block: string | undefined | null): string | null {
  if (!block) return null
  const normalized = block
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' | ')
    .replace(/[.,;:]/g, '')
  return normalized.length > 0 ? normalized : null
}

/**
 * Merkt sich eine manuell gesetzte Länder-Zuordnung für genau diese Adresse.
 * Sie hat bei künftigen Läufen Vorrang vor der automatischen Erkennung –
 * so „lernt“ die App bestätigte Abweichungen.
 */
export function saveAddressCountryOverride(block: string | undefined | null, isoCode: string): void {
  const key = addressFingerprint(block)
  if (!key) return
  const all = readJson<Record<string, string>>(ADDRESS_STORAGE_KEY, {})
  all[key] = isoCode
  writeJson(ADDRESS_STORAGE_KEY, all)
}

export function lookupAddressCountryOverride(block: string | undefined | null): string | null {
  const key = addressFingerprint(block)
  if (!key) return null
  return readJson<Record<string, string>>(ADDRESS_STORAGE_KEY, {})[key] ?? null
}
