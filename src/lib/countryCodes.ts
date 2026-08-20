/**
 * Zuordnung von (deutschen) Ländernamen zu ISO-3166-1-Alpha-2-Codes.
 * Nur für die in der EU/im typischen Intrastat-Kontext relevanten Länder
 * gepflegt. Ist ein Land nicht eindeutig zuordenbar, wird `null`
 * zurückgegeben – es darf niemals geraten werden (Anforderung Abschnitt 6).
 */

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  belgien: 'BE',
  bulgarien: 'BG',
  daenemark: 'DK',
  dänemark: 'DK',
  deutschland: 'DE',
  estland: 'EE',
  finnland: 'FI',
  frankreich: 'FR',
  griechenland: 'GR',
  irland: 'IE',
  italien: 'IT',
  kroatien: 'HR',
  lettland: 'LV',
  litauen: 'LT',
  luxemburg: 'LU',
  malta: 'MT',
  niederlande: 'NL',
  oesterreich: 'AT',
  österreich: 'AT',
  polen: 'PL',
  portugal: 'PT',
  rumaenien: 'RO',
  rumänien: 'RO',
  schweden: 'SE',
  slowakei: 'SK',
  slowenien: 'SI',
  spanien: 'ES',
  tschechien: 'CZ',
  'tschechische republik': 'CZ',
  ungarn: 'HU',
  zypern: 'CY',
  // gebräuchliche Nicht-EU-Nachbarländer, häufig in Rechnungsanschriften
  schweiz: 'CH',
  'vereinigtes koenigreich': 'GB',
  'vereinigtes königreich': 'GB',
  grossbritannien: 'GB',
  großbritannien: 'GB',
  norwegen: 'NO',
}

// Bereits gültige ISO-Codes werden erkannt, wenn sie direkt als solche vorliegen.
const VALID_ISO_CODES = new Set([
  'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB',
  'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT',
  'RO', 'SE', 'SI', 'SK',
])

function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '')
}

/**
 * Versucht, aus einem Freitext-Ländernamen (oder bereits vorhandenem
 * ISO-Code) einen eindeutigen zweistelligen Code zu bestimmen.
 * Gibt `null` zurück, wenn keine eindeutige Zuordnung möglich ist.
 */
export function resolveCountryCode(nameOrCode: string | undefined | null): string | null {
  if (!nameOrCode) return null
  const trimmed = nameOrCode.trim()
  if (/^[A-Za-z]{2}$/.test(trimmed) && VALID_ISO_CODES.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase()
  }
  const key = normalize(trimmed)
  return COUNTRY_NAME_TO_CODE[key] ?? null
}

// Anzeigenamen (mit korrekter Groß-/Kleinschreibung) für die manuelle Auswahl
// in der Benutzeroberfläche. Der Abgleich selbst erfolgt weiterhin
// unabhängig davon über `resolveCountryCode`/`COUNTRY_NAME_TO_CODE`.
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

export function listKnownCountries(): { name: string; code: string }[] {
  return Object.entries(DISPLAY_NAME_BY_CODE)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
