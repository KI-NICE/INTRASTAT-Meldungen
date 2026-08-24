import type { DestinationCountryInfo } from '../types'

/**
 * Länder-Hilfsfunktionen für die Intrastat-Meldung.
 *
 * Das Bestimmungsland selbst liest Claude direkt aus der Rechnung (siehe
 * `aiInvoiceBuilder.ts`) und liefert bereits den ISO-3166-1-Alpha-2-Code.
 * Diese Datei stellt nur noch die Anzeige-Namen für die manuelle Auswahl in
 * der Prüfansicht sowie den fachlich vorgeschriebenen Abgleich mit der
 * USt-IdNr. des Warenempfängers bereit.
 */

const VALID_ISO_CODES = new Set([
  'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB',
  'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT',
  'RO', 'SE', 'SI', 'SK',
])

// Anzeigenamen für die manuelle Auswahl in der Benutzeroberfläche.
const DISPLAY_NAME_BY_CODE: Record<string, string> = {
  AT: 'Österreich',
  BE: 'Belgien',
  BG: 'Bulgarien',
  CH: 'Schweiz',
  CY: 'Zypern',
  CZ: 'Tschechien',
  DE: 'Deutschland',
  DK: 'Dänemark',
  EE: 'Estland',
  ES: 'Spanien',
  FI: 'Finnland',
  FR: 'Frankreich',
  GB: 'Vereinigtes Königreich',
  GR: 'Griechenland',
  HR: 'Kroatien',
  HU: 'Ungarn',
  IE: 'Irland',
  IT: 'Italien',
  LT: 'Litauen',
  LU: 'Luxemburg',
  LV: 'Lettland',
  MT: 'Malta',
  NL: 'Niederlande',
  NO: 'Norwegen',
  PL: 'Polen',
  PT: 'Portugal',
  RO: 'Rumänien',
  SE: 'Schweden',
  SI: 'Slowenien',
  SK: 'Slowakei',
}

/**
 * Länderpräfix der USt-IdNr. → ISO-3166-1-Alpha-2. Weicht an wenigen Stellen
 * vom sonst identischen ISO-Code ab (Griechenland: "EL", Nordirland: "XI").
 */
const VAT_PREFIX_TO_ISO: Record<string, string> = {
  EL: 'GR',
  XI: 'GB',
}

/**
 * Löst das Länderkürzel aus dem Präfix einer USt-IdNr. auf (z. B. "BE" aus
 * "BE0123456789"). Liefert `null`, wenn kein gültiges Präfix erkennbar ist.
 */
export function resolveCountryFromVatId(vatId: string | undefined | null): string | null {
  if (!vatId) return null
  const match = vatId.trim().toUpperCase().match(/^([A-Z]{2})/)
  if (!match) return null
  const prefix = match[1]
  if (VAT_PREFIX_TO_ISO[prefix]) return VAT_PREFIX_TO_ISO[prefix]
  return VALID_ISO_CODES.has(prefix) ? prefix : null
}

/**
 * Gleicht das von Claude gelesene Bestimmungsland mit dem Länderpräfix der
 * USt-IdNr. des Warenempfängers ab. Das Länderkürzel muss zur USt-IdNr.
 * passen – bei einer Abweichung sticht die USt-IdNr. das gelesene
 * Bestimmungsland aus. Eine bereits manuell bestätigte Auswahl wird nicht
 * automatisch überschrieben.
 */
export function crosscheckDestinationCountryWithVatId(
  destinationCountry: DestinationCountryInfo | undefined,
  vatId: string | undefined,
): DestinationCountryInfo | undefined {
  if (!destinationCountry || destinationCountry.isManual) return destinationCountry

  const vatCountry = resolveCountryFromVatId(vatId)
  if (!vatCountry || vatCountry === destinationCountry.code) return destinationCountry

  return {
    ...destinationCountry,
    code: vatCountry,
    source: 'vat-id-override',
    needsConfirmation: false,
    overriddenAddressCode: destinationCountry.code,
  }
}

export function listKnownCountries(): { name: string; code: string }[] {
  return Object.entries(DISPLAY_NAME_BY_CODE)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export function countryDisplayName(code: string | null | undefined): string {
  if (!code) return '—'
  return DISPLAY_NAME_BY_CODE[code] ?? code
}
