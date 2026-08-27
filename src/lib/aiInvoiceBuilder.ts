import type { Invoice, InvoiceDirection, InvoicePosition } from '../types'

/**
 * Baut das interne Rechnungs-/Positionsmodell für manuell erfasste
 * Rechnungen auf (siehe excelImport.ts für den Excel-Import-Weg).
 */

/**
 * Artikelnummern mit dem Präfix "09" sind grundsätzlich keine Warenpositionen
 * (Frachtkosten, sonstige Zuschläge, Materialteuerungszuschläge): Sie wiegen
 * nie etwas und werden nicht als eigene Intrastat-Zeile gemeldet. Ihr Betrag
 * wird entweder anteilig nach Wertanteil auf die übrigen (echten) Positionen
 * der Rechnung umgelegt oder – bei erkannten Materialteuerungszuschlägen –
 * direkt der vorangehenden Artikelposition zugerechnet (siehe
 * excelImport.attributeMtzToPreviousPosition).
 */
export function isNonMerchandiseArticleNumber(articleNumberRaw: string | undefined): boolean {
  return !!articleNumberRaw && articleNumberRaw.startsWith('09')
}

/**
 * Erlaubt die Eingabe eines Rechnungsdatums auch als reine Ziffernfolge ohne
 * Punkte, z. B. "01072026" oder "010726" (Tag/Monat/2- oder 4-stelliges
 * Jahr), und wandelt sie automatisch ins Format TT.MM.JJJJ um. Enthält die
 * Eingabe bereits Punkte oder ist sie keine reine 6- bzw. 8-stellige
 * Ziffernfolge, bleibt sie unverändert (dann tippt der Nutzer noch).
 */
export function normalizeInvoiceDateInput(raw: string): string {
  const trimmed = raw.trim()
  if (!/^\d{6}$|^\d{8}$/.test(trimmed)) return raw
  const day = trimmed.slice(0, 2)
  const month = trimmed.slice(2, 4)
  const year = trimmed.length === 8 ? trimmed.slice(4, 8) : `20${trimmed.slice(4, 6)}`
  return `${day}.${month}.${year}`
}

/**
 * Löst ein mit Schrägstrichen geschriebenes Datum ("TT/MM/JJJJ" ODER
 * "MM/TT/JJJJ" – auf der Rechnung nicht unterscheidbar) sinngemäß anhand des
 * gewählten Bezugsmonats auf und gibt es im Format TT.MM.JJJJ zurück. Punkt-
 * getrennte Daten gelten bereits als eindeutig (TT.MM.JJJJ) und werden nicht
 * angefasst.
 *
 * Stimmt genau eine der beiden Lesarten mit dem gewählten Bezugsmonat
 * überein, gewinnt diese. Sind beide oder keine der Lesarten möglich (z. B.
 * weil noch kein Bezugsmonat gewählt wurde), wird nach europäischer
 * Konvention TT/MM/JJJJ angenommen – außer diese Lesart ergäbe einen
 * ungültigen Monat (>12), dann wird auf MM/TT/JJJJ ausgewichen.
 */
export function resolveAmbiguousDateFormat(dateRaw: string | undefined, selectedMonth?: string): string | undefined {
  if (!dateRaw) return dateRaw
  const match = dateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return dateRaw

  const first = match[1].padStart(2, '0')
  const second = match[2].padStart(2, '0')
  let year = match[3]
  if (year.length === 2) year = `20${year}`

  const asDayMonth = { day: first, month: second } // TT/MM/JJJJ
  const asMonthDay = { day: second, month: first } // MM/TT/JJJJ
  const dayMonthValid = Number(asDayMonth.month) >= 1 && Number(asDayMonth.month) <= 12
  const monthDayValid = Number(asMonthDay.month) >= 1 && Number(asMonthDay.month) <= 12

  let chosen = asDayMonth
  if (selectedMonth && asDayMonth.month === selectedMonth && asMonthDay.month !== selectedMonth) {
    chosen = asDayMonth
  } else if (selectedMonth && asMonthDay.month === selectedMonth && asDayMonth.month !== selectedMonth) {
    chosen = asMonthDay
  } else if (!dayMonthValid && monthDayValid) {
    chosen = asMonthDay
  }

  return `${chosen.day}.${chosen.month}.${year}`
}

/** Leitet Monat und Jahr (Bezugsmonat) aus dem Rechnungsdatum (TT.MM.JJJJ) ab. */
export function deriveReferencePeriod(dateRaw: string | undefined): { month: string; year: string } | undefined {
  if (!dateRaw) return undefined
  const parts = dateRaw.split('.')
  if (parts.length !== 3) return undefined
  const month = parts[1].trim().padStart(2, '0')
  let year = parts[2].trim()
  if (year.length === 2) year = `20${year}`
  if (!/^\d{2}$/.test(month) || !/^\d{4}$/.test(year)) return undefined
  return { month, year }
}

/** Baut eine leere Rechnung für die vollständig manuelle Erfassung auf. */
export function buildManualInvoice(id: string, richtung: InvoiceDirection): Invoice {
  return {
    id,
    fileName: 'Manuell erfasst',
    richtung,
    isManualEntry: true,
    language: 'de',
    ...(richtung === 'V'
      ? { versendungsMitgliedstaat: '', bestimmungsBundesland: '', ursprungsBundesland: '09', ursprungsland: 'DE' }
      : { bestimmungsBundesland: '09', ursprungsBundesland: '' }),
    positions: [],
    manualCorrections: [],
    issues: [],
    status: 'pending',
  }
}

let manualPositionCounter = 0

/**
 * Erzeugt eine leere, manuell auszufüllende Position für eine Rechnung.
 * `positionNumber` sollte der Zehnerfolge realer Rechnungen entsprechen
 * ("10", "20", "30", …) – siehe `App.handleAddPosition`.
 */
export function buildManualPosition(positionNumber?: string): InvoicePosition {
  manualPositionCounter += 1
  return {
    id: `manual-pos-${manualPositionCounter}`,
    lineNo: manualPositionCounter,
    positionNumber,
    productNameRaw: '',
    isSpecialUnit: false,
    isTransportCost: false,
    isMtzSurcharge: false,
    isCreditOrDiscountOrNegative: false,
    isManualEntry: true,
    manualCorrections: [],
    issues: [],
    status: 'ok',
    requiresManualDecision: false,
  }
}
