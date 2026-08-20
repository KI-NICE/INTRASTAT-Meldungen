/**
 * Auflösung von Länderangaben in Rechnungsadressen zu ISO-3166-1-Alpha-2-Codes.
 *
 * In den Adressen werden die klassischen Länder-Kennzeichen als Präfix vor der
 * Postleitzahl verwendet (z. B. "A-1010 Wien", "B-1000 Brüssel",
 * "D-70173 Stuttgart"). Diese ein- bis dreibuchstabigen Kennzeichen sind NICHT
 * identisch mit den ISO-Codes und werden hier explizit übersetzt.
 *
 * Grundsatz: Ist die Zuordnung nicht eindeutig, wird `null` geliefert – es darf
 * kein Ländercode geraten werden (Anforderung Abschnitt 6).
 */

/** Klassische Länder-Kennzeichen (Kfz-Kennzeichen) → ISO-3166-1-Alpha-2. */
const VEHICLE_CODE_TO_ISO: Record<string, string> = {
  A: 'AT',
  B: 'BE',
  BG: 'BG',
  CH: 'CH',
  CY: 'CY',
  CZ: 'CZ',
  D: 'DE',
  DK: 'DK',
  E: 'ES',
  EE: 'EE',
  EST: 'EE',
  F: 'FR',
  FI: 'FI',
  FIN: 'FI',
  GB: 'GB',
  GR: 'GR',
  H: 'HU',
  HR: 'HR',
  I: 'IT',
  IRL: 'IE',
  IE: 'IE',
  L: 'LU',
  LT: 'LT',
  LV: 'LV',
  M: 'MT',
  MT: 'MT',
  N: 'NO',
  NL: 'NL',
  P: 'PT',
  PL: 'PL',
  RO: 'RO',
  S: 'SE',
  SE: 'SE',
  SK: 'SK',
  SLO: 'SI',
  SI: 'SI',
}

/** Ländernamen (deutsch und englisch) → ISO-3166-1-Alpha-2. */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  belgien: 'BE',
  belgium: 'BE',
  bulgarien: 'BG',
  bulgaria: 'BG',
  daenemark: 'DK',
  dänemark: 'DK',
  denmark: 'DK',
  deutschland: 'DE',
  germany: 'DE',
  estland: 'EE',
  estonia: 'EE',
  finnland: 'FI',
  finland: 'FI',
  frankreich: 'FR',
  france: 'FR',
  griechenland: 'GR',
  greece: 'GR',
  irland: 'IE',
  ireland: 'IE',
  italien: 'IT',
  italy: 'IT',
  italia: 'IT',
  kroatien: 'HR',
  croatia: 'HR',
  lettland: 'LV',
  latvia: 'LV',
  litauen: 'LT',
  lithuania: 'LT',
  luxemburg: 'LU',
  luxembourg: 'LU',
  malta: 'MT',
  niederlande: 'NL',
  netherlands: 'NL',
  oesterreich: 'AT',
  österreich: 'AT',
  austria: 'AT',
  polen: 'PL',
  poland: 'PL',
  portugal: 'PT',
  rumaenien: 'RO',
  rumänien: 'RO',
  romania: 'RO',
  schweden: 'SE',
  sweden: 'SE',
  schweiz: 'CH',
  switzerland: 'CH',
  slowakei: 'SK',
  slovakia: 'SK',
  slowenien: 'SI',
  slovenia: 'SI',
  spanien: 'ES',
  spain: 'ES',
  tschechien: 'CZ',
  'tschechische republik': 'CZ',
  'czech republic': 'CZ',
  czechia: 'CZ',
  ungarn: 'HU',
  hungary: 'HU',
  zypern: 'CY',
  cyprus: 'CY',
  'vereinigtes koenigreich': 'GB',
  'vereinigtes königreich': 'GB',
  grossbritannien: 'GB',
  großbritannien: 'GB',
  'united kingdom': 'GB',
  norwegen: 'NO',
  norway: 'NO',
}

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

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '')
}

/**
 * Löst ein einzelnes Länder-Token auf: ein Länder-Kennzeichen ("A", "B", "D"),
 * einen ISO-Code oder einen Ländernamen. `null`, wenn nicht eindeutig.
 */
export function resolveCountryToken(token: string | undefined | null): string | null {
  if (!token) return null
  const trimmed = token.trim().replace(/[.,;:]+$/, '')
  if (trimmed === '') return null

  const upper = trimmed.toUpperCase()

  // Länder-Kennzeichen (A, B, D, NL, SLO, …) – hat Vorrang, da in den
  // Adressen genau diese Schreibweise verwendet wird.
  if (/^[A-Z]{1,3}$/.test(upper) && VEHICLE_CODE_TO_ISO[upper]) {
    return VEHICLE_CODE_TO_ISO[upper]
  }

  // Bereits gültiger ISO-Code
  if (/^[A-Z]{2}$/.test(upper) && VALID_ISO_CODES.has(upper)) {
    return upper
  }

  // Ländername
  return COUNTRY_NAME_TO_CODE[normalize(trimmed)] ?? null
}

/** Rückwärtskompatible Bezeichnung (wird an mehreren Stellen verwendet). */
export const resolveCountryCode = resolveCountryToken

export type AddressCountryDetection = {
  /** Aufgelöster ISO-Code oder null, wenn keine eindeutige Zuordnung möglich ist. */
  code: string | null
  /** Das im Adresstext gefundene Token (z. B. "A", "B", "Belgien"), falls vorhanden. */
  token: string | null
  /** Woraus das Token stammt – nur zur Nachvollziehbarkeit in der Prüfansicht. */
  source: 'plz-praefix' | 'landname' | 'iso-code' | 'kein-token'
}

/**
 * Ermittelt aus einem Adressblock das Bestimmungsland.
 *
 * Erkennungsreihenfolge:
 *  1. Länder-Kennzeichen vor der Postleitzahl, z. B. "A-1010 Wien"
 *  2. ausgeschriebener Ländername in einer eigenen Zeile
 *  3. alleinstehender ISO-Code in einer eigenen Zeile
 */
export function detectCountryFromAddress(block: string | undefined | null): AddressCountryDetection {
  if (!block) return { code: null, token: null, source: 'kein-token' }

  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // 1. Länder-Kennzeichen vor der Postleitzahl: "A-1010 Wien", "NL- 1234 AB"
  for (const line of lines) {
    const match = line.match(/(?:^|\s)([A-Za-z]{1,3})\s*-\s*(\d{4,6})\b/)
    if (match) {
      const token = match[1].toUpperCase()
      const code = VEHICLE_CODE_TO_ISO[token] ?? null
      return { code, token, source: 'plz-praefix' }
    }
  }

  // 2. Ausgeschriebener Ländername (eigene Zeile)
  for (const line of lines) {
    const code = COUNTRY_NAME_TO_CODE[normalize(line)]
    if (code) return { code, token: line, source: 'landname' }
  }

  // 3. Alleinstehender ISO-Code in eigener Zeile
  for (const line of lines) {
    const upper = line.toUpperCase()
    if (/^[A-Z]{2}$/.test(upper) && VALID_ISO_CODES.has(upper)) {
      return { code: upper, token: line, source: 'iso-code' }
    }
  }

  return { code: null, token: null, source: 'kein-token' }
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
