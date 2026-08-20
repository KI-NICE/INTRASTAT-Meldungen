import type { Address, Invoice, InvoicePosition } from '../types'
import { parseGermanNumber } from './germanNumber'
import { resolveCountryCode } from './countryCodes'

/**
 * Heuristischer Parser für die in den Anforderungen beschriebenen
 * Rechnungsfelder. Das genaue Rechnungslayout ist nicht bekannt; der Parser
 * geht davon aus, dass die genannten Feldbezeichnungen ("Vom:",
 * "Zolltarif-Nr.:"/"Zolltarif-Nr..:", "Menge", "Betrag", "Ihre USt-IdNr.:",
 * "Produktbezeichnung") im extrahierten Text vorkommen – ggf. je
 * Rechnungsposition wiederholt. Wird ein Feld nicht eindeutig gefunden,
 * bleibt es undefined; die Validierung markiert die Rechnung dann als
 * unvollständig (kein Raten von Werten, siehe Grundregeln).
 */

function extractFirstMatch(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern)
  return match ? match[1].trim() : undefined
}

export function extractInvoiceNumber(text: string): string | undefined {
  return extractFirstMatch(text, /Rechnungs(?:nummer|-?Nr\.?)\s*:?\s*([A-Za-z0-9\-/]+)/i)
}

export function extractInvoiceDate(text: string): string | undefined {
  return extractFirstMatch(text, /Rechnungsdatum\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i)
}

/** Liest das Feld "Vom:" oben rechts und liefert { month: "MM", year: "JJJJ" } zurück. */
export function extractReferenceMonth(text: string): { month: string; year: string; raw: string } | undefined {
  const raw = extractFirstMatch(text, /\bVom\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i)
  if (!raw) return undefined
  const parts = raw.split('.')
  if (parts.length !== 3) return undefined
  const month = parts[1].padStart(2, '0')
  let year = parts[2]
  if (year.length === 2) year = `20${year}`
  return { month, year, raw }
}

export function extractVatId(text: string): string | undefined {
  const raw = extractFirstMatch(
    text,
    /Ihre\s+USt-?IdNr\.?\s*:?\s*([A-Za-z]{2}[A-Za-z0-9 ]*[A-Za-z0-9])/i,
  )
  if (!raw) return undefined
  return raw.replace(/\s+/g, '')
}

export function extractNetWeightTotal(text: string): number | undefined {
  const raw = extractFirstMatch(text, /Netto-?Gesamtgewicht\s*:?\s*([0-9.,]+)\s*kg/i)
  const value = parseGermanNumber(raw ?? null)
  return value ?? undefined
}

export function extractGoodsValueTotal(text: string): number | undefined {
  const raw = extractFirstMatch(
    text,
    /Warenwert(?:\s*gesamt|\s*insgesamt)?\s*:?\s*([0-9.,]+)\s*(?:EUR|€)?/i,
  )
  const value = parseGermanNumber(raw ?? null)
  return value ?? undefined
}

export function extractFreightCost(text: string): number | undefined {
  const raw = extractFirstMatch(text, /Frachtkosten\s*:?\s*([0-9.,]+)\s*(?:EUR|€)?/i)
  const value = parseGermanNumber(raw ?? null)
  return value ?? undefined
}

export function extractDeliveryAddressBlock(text: string): string | undefined {
  const match = text.match(
    /Lieferadresse\s*:?\s*\n?([\s\S]*?)(?:\n\s*\n|Rechnungsnummer|Rechnungsdatum|\bVom\s*:|Position\s|Produktbezeichnung|$)/i,
  )
  return match ? match[1].trim() : undefined
}

/** Grobe Heuristik: die ersten nicht-leeren Zeilen vor dem ersten bekannten Rechnungsfeld gelten als Empfänger-Briefkopf. */
export function extractRecipientAddressBlock(text: string): string | undefined {
  const stopIndex = text.search(/Rechnungsnummer|Rechnungsdatum|\bVom\s*:|Lieferadresse|Ihre\s+USt-?IdNr/i)
  const header = stopIndex > -1 ? text.slice(0, stopIndex) : text.slice(0, 400)
  const lines = header
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return undefined
  // Die letzten Zeilen vor dem Stop sind typischerweise die Empfängeradresse
  // (inkl. Firmenname); die einleitenden Zeilen (eigener Briefkopf) werden
  // großzügig mit erfasst, da eine exakte Trennung ohne festes Layout nicht
  // zuverlässig möglich ist.
  return lines.slice(Math.max(0, lines.length - 8)).join('\n')
}

const KNOWN_COUNTRY_NAMES = [
  'Deutschland', 'Österreich', 'Oesterreich', 'Schweiz', 'Belgien', 'Niederlande',
  'Frankreich', 'Italien', 'Spanien', 'Portugal', 'Polen', 'Tschechien',
  'Tschechische Republik', 'Slowakei', 'Slowenien', 'Ungarn', 'Kroatien',
  'Rumänien', 'Rumaenien', 'Bulgarien', 'Griechenland', 'Dänemark', 'Daenemark',
  'Schweden', 'Finnland', 'Estland', 'Lettland', 'Litauen', 'Irland', 'Luxemburg',
  'Malta', 'Zypern', 'Vereinigtes Königreich', 'Großbritannien',
]

/** Extrahiert eine Adresse inkl. Ländername/-code aus einem Adressblock. */
export function parseAddress(block: string | undefined): Address | undefined {
  if (!block) return undefined
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return undefined

  // 1. explizit genannter Ländername irgendwo im Block
  let countryNameRaw: string | undefined
  for (const name of KNOWN_COUNTRY_NAMES) {
    if (lines.some((l) => l.toLowerCase() === name.toLowerCase())) {
      countryNameRaw = name
      break
    }
  }
  // 2. letzte Zeile als Fallback (häufig nur der Ländername oder "PLZ Ort")
  if (!countryNameRaw) {
    const lastLine = lines[lines.length - 1]
    if (KNOWN_COUNTRY_NAMES.some((n) => n.toLowerCase() === lastLine.toLowerCase())) {
      countryNameRaw = lastLine
    }
  }

  const countryCode = countryNameRaw ? resolveCountryCode(countryNameRaw) ?? undefined : undefined

  return { raw: block, countryNameRaw, countryCode }
}

const CUSTOMS_CODE_LABEL = /Zolltarif-?Nr\.?\.?\s*:?\s*([0-9]{5,10})/gi

/**
 * Zerlegt den Rechnungstext in Blöcke je Rechnungsposition, jeweils verankert
 * an einem Vorkommen des Feldes "Zolltarif-Nr.:" bzw. "Zolltarif-Nr..:".
 */
export function extractPositions(text: string): InvoicePosition[] {
  const anchors = [...text.matchAll(CUSTOMS_CODE_LABEL)]
  if (anchors.length === 0) return []

  const positions: InvoicePosition[] = []

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]
    const blockStart = i === 0 ? Math.max(0, (anchor.index ?? 0) - 300) : (anchors[i - 1].index ?? 0)
    const blockEnd = i < anchors.length - 1 ? (anchors[i + 1].index ?? text.length) : text.length
    const block = text.slice(blockStart, blockEnd)

    const customsCodeRaw = anchor[1]
    const customsCode = customsCodeRaw.replace(/\D/g, '')

    const productNameLabelMatch = block.match(/Produktbezeichnung\s*:?\s*(.+)/i)
    let productNameRaw = productNameLabelMatch?.[1]?.trim()
    if (!productNameRaw) {
      // Fallback: erste sinnvolle Zeile im Block, die kein bekanntes Feldlabel ist
      const candidateLines = block
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 &&
            !/^(Zolltarif-?Nr|Menge|Betrag|Position|Produktbezeichnung)\b/i.test(l),
        )
      productNameRaw = candidateLines[0] ?? ''
    }

    const quantityRaw = extractFirstMatch(block, /Menge\s*:?\s*([0-9.,]+)/i)
    const amountRaw = extractFirstMatch(block, /Betrag\s*:?\s*([0-9.,]+)\s*(?:EUR|€)?/i)

    const quantity = parseGermanNumber(quantityRaw ?? null) ?? undefined
    const amountEur = parseGermanNumber(amountRaw ?? null) ?? undefined

    const isSpecialUnit = customsCode === '39233010'

    const negativeMarkers = /(Gutschrift|Storno(?:rechnung)?|Rabatt)/i
    const isNegativeAmount = amountEur != null && amountEur < 0
    const negativeReasonMatch = block.match(negativeMarkers)
    const isCreditOrDiscountOrNegative = isNegativeAmount || !!negativeReasonMatch

    positions.push({
      id: `pos-${i + 1}-${customsCode}`,
      lineNo: i + 1,
      productNameRaw: productNameRaw || '',
      customsCodeRaw,
      customsCode,
      quantityRaw,
      quantity,
      amountRaw,
      amountEur,
      isSpecialUnit,
      isCreditOrDiscountOrNegative,
      negativeReason: negativeReasonMatch?.[1],
      manualCorrections: [],
      issues: [],
      status: 'ok',
      requiresManualDecision: isCreditOrDiscountOrNegative,
    })
  }

  return positions
}

export type ParsedInvoiceFields = Pick<
  Invoice,
  | 'invoiceNumber'
  | 'invoiceDateRaw'
  | 'referenceMonth'
  | 'referenceYear'
  | 'vatIdRaw'
  | 'vatId'
  | 'netWeightTotalRaw'
  | 'netWeightTotal'
  | 'goodsValueTotalRaw'
  | 'goodsValueTotal'
  | 'freightCostRaw'
  | 'freightCost'
  | 'recipient'
  | 'deliveryAddress'
  | 'positions'
>

export function parseInvoiceText(text: string): ParsedInvoiceFields {
  const refMonth = extractReferenceMonth(text)
  const vatIdRaw = extractVatId(text)
  const netWeightTotalRaw = extractFirstMatch(text, /Netto-?Gesamtgewicht\s*:?\s*([0-9.,]+)\s*kg/i)
  const goodsValueTotalRaw = extractFirstMatch(
    text,
    /Warenwert(?:\s*gesamt|\s*insgesamt)?\s*:?\s*([0-9.,]+)\s*(?:EUR|€)?/i,
  )
  const freightCostRaw = extractFirstMatch(text, /Frachtkosten\s*:?\s*([0-9.,]+)\s*(?:EUR|€)?/i)

  return {
    invoiceNumber: extractInvoiceNumber(text),
    invoiceDateRaw: extractInvoiceDate(text),
    referenceMonth: refMonth?.month,
    referenceYear: refMonth?.year,
    vatIdRaw,
    vatId: vatIdRaw,
    netWeightTotalRaw,
    netWeightTotal: extractNetWeightTotal(text),
    goodsValueTotalRaw,
    goodsValueTotal: extractGoodsValueTotal(text),
    freightCostRaw,
    freightCost: extractFreightCost(text),
    recipient: parseAddress(extractRecipientAddressBlock(text)),
    deliveryAddress: parseAddress(extractDeliveryAddressBlock(text)),
    positions: extractPositions(text),
  }
}

/**
 * Bestimmt das Bestimmungsland gemäß Priorität: Lieferadresse vor
 * Empfängeradresse (Anforderung Abschnitt 6). Ist keine eindeutige
 * Zuordnung möglich, muss der Aufrufer eine manuelle Auswahl anfordern.
 */
export function determineDestinationCountry(
  deliveryAddress: Address | undefined,
  recipient: Address | undefined,
): { code: string | null; source: 'delivery' | 'recipient' | 'unresolved' } {
  if (deliveryAddress?.countryCode) {
    return { code: deliveryAddress.countryCode, source: 'delivery' }
  }
  if (recipient?.countryCode) {
    return { code: recipient.countryCode, source: 'recipient' }
  }
  return { code: null, source: 'unresolved' }
}
