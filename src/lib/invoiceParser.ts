import type { Address, AddressKind, Invoice, InvoicePosition } from '../types'
import { parseGermanNumber } from './germanNumber'
import { detectCountryFromAddress } from './countryCodes'
import { lookupCountryMapping } from './mappingStore'

/**
 * Parser für die Rechnungsfelder. Die Erkennung folgt den fachlich
 * bestätigten Fundstellen:
 *
 *  - Rechnungsdatum: Feld "vom:" direkt unter der Rechnungsnummer.
 *    Das Feld "Ihr Auftrag vom:" wird ausdrücklich ignoriert.
 *  - Netto-Gesamtgewicht: in der Fußzeile hinter einer Sternchen-Trennlinie,
 *    beschriftet mit "Net weight:" oder "Netto:".
 *  - Menge: je Position im Format "#.###,## Stück".
 *  - Bestimmungsland: Lieferadresse, sonst Auftragsadresse.
 *
 * Grundsatz: Wird ein Feld nicht eindeutig gefunden, bleibt es undefined.
 * Die Validierung markiert die Rechnung dann als klärungsbedürftig – es
 * werden keine Werte geraten.
 */

function extractFirstMatch(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern)
  return match ? match[1].trim() : undefined
}

export function extractInvoiceNumber(text: string): string | undefined {
  return extractFirstMatch(
    text,
    /Rechnung(?:s)?(?:nummer|-?\s?Nr\.?|\s+Nr\.?)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)/i,
  )
}

const DATE_PATTERN = /(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})/

/**
 * Liest das Rechnungsdatum aus dem Feld "vom:".
 *
 * Wichtig: Auf der Rechnung existieren mehrere "vom:"-Felder. Nur das Feld
 * direkt unter der Rechnungsnummer ist das Rechnungsdatum; Felder wie
 * "Ihr Auftrag vom:", "Lieferschein vom:" oder "Bestellung vom:" werden
 * ausgeschlossen.
 */
export function extractInvoiceDate(text: string): string | undefined {
  const candidates: { index: number; value: string }[] = []
  const regex = /vom\s*:?\s*/gi

  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0

    // Kontext vor dem Treffer prüfen: gehört das "vom:" zu einem anderen Bezug?
    const contextBefore = text.slice(Math.max(0, index - 40), index)
    if (/(Auftrag|Bestellung|Lieferschein|Anfrage|Angebot|Order|Auftragsbest)/i.test(contextBefore)) {
      continue
    }

    const after = text.slice(index + match[0].length, index + match[0].length + 20)
    const dateMatch = after.match(DATE_PATTERN)
    if (!dateMatch) continue

    candidates.push({ index, value: dateMatch[1].replace(/\s/g, '') })
  }

  if (candidates.length === 0) return undefined

  // Bevorzugt das "vom:" unmittelbar nach der Rechnungsnummer.
  const invoiceNumberMatch = text.match(/Rechnung(?:s)?(?:nummer|-?\s?Nr\.?|\s+Nr\.?)/i)
  if (invoiceNumberMatch?.index != null) {
    const after = candidates.filter((c) => c.index > (invoiceNumberMatch.index ?? 0))
    if (after.length > 0) return after[0].value
  }

  return candidates[0].value
}

/** Leitet Monat und Jahr (Bezugsmonat) aus dem Rechnungsdatum ab. */
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

export function extractVatId(text: string): string | undefined {
  const raw = extractFirstMatch(
    text,
    /Ihre\s+USt-?\s?IdNr\.?\s*:?\s*([A-Za-z]{2}[A-Za-z0-9 ]*[A-Za-z0-9])/i,
  )
  if (!raw) return undefined
  return raw.replace(/\s+/g, '')
}

/**
 * Liest das Netto-Gesamtgewicht aus der Fußzeile. Erwartet wird eine
 * Sternchen-Trennlinie, gefolgt von "Net weight:" bzw. "Netto:".
 */
export function extractNetWeightTotal(text: string): { value: number; raw: string } | undefined {
  // 1. Bevorzugt: hinter der Sternchen-Trennlinie
  const afterStars = text.match(
    /\*{5,}[\s\S]{0,80}?(?:Net\s*weight|Nettogewicht|Netto)\s*:?\s*([0-9][0-9.,]*)\s*(kg|EUR|€)?/i,
  )
  if (afterStars && !/EUR|€/i.test(afterStars[2] ?? '')) {
    const value = parseGermanNumber(afterStars[1])
    if (value != null) return { value, raw: afterStars[1] }
  }

  // 2. Ausdrücklich benanntes Netto-Gesamtgewicht
  const explicit = text.match(/Netto-?\s?Gesamtgewicht\s*:?\s*([0-9][0-9.,]*)\s*kg/i)
  if (explicit) {
    const value = parseGermanNumber(explicit[1])
    if (value != null) return { value, raw: explicit[1] }
  }

  // 3. "Net weight:" / "Netto:" ohne Trennlinie – nur akzeptieren, wenn keine
  //    Währungsangabe folgt (sonst wäre es ein Netto-Betrag, kein Gewicht).
  const labelled = [...text.matchAll(/(?:Net\s*weight|Nettogewicht|Netto)\s*:?\s*([0-9][0-9.,]*)\s*(kg|EUR|€)?/gi)]
  for (const match of labelled) {
    const unit = match[2] ?? ''
    if (/EUR|€/i.test(unit)) continue
    const value = parseGermanNumber(match[1])
    if (value != null) return { value, raw: match[1] }
  }

  return undefined
}

export function extractGoodsValueTotal(text: string): number | undefined {
  const raw = extractFirstMatch(
    text,
    /Warenwert(?:\s*gesamt|\s*insgesamt)?\s*:?\s*([0-9][0-9.,]*)\s*(?:EUR|€)?/i,
  )
  const value = parseGermanNumber(raw ?? null)
  return value ?? undefined
}

export function extractFreightCost(text: string): number | undefined {
  const raw = extractFirstMatch(
    text,
    /(?:Frachtkosten|Fracht|Versandkosten|Freight)\s*:?\s*([0-9][0-9.,]*)\s*(?:EUR|€)?/i,
  )
  const value = parseGermanNumber(raw ?? null)
  return value ?? undefined
}

/* ------------------------------------------------------------------ Adressen */

const FIELD_LABEL_PATTERN =
  /^(Rechnung|Rechnungsnummer|Rechnungs-?Nr|Rechnungsdatum|vom\s*:|Ihr\s+Auftrag|Ihre\s+USt|Kundennummer|Kunden-?Nr|Seite|Pos\b|Position|Menge|Bezeichnung|Betrag|Zolltarif|Lieferadresse|Auftragsadresse|Liefer-?anschrift|Zahlungsbedingungen|Lieferbedingungen)/i

const DELIVERY_LABELS = /(Lieferadresse|Liefer-?\s?Adresse|Lieferanschrift|Delivery\s+address)/i
const ORDER_LABELS = /(Auftragsadresse|Auftrags-?\s?Adresse|Bestelladresse|Auftraggeber)/i

/**
 * Extrahiert den Adressblock hinter einer Beschriftung. Es werden maximal
 * `maxLines` Folgezeilen übernommen; die Übernahme endet an einer Leerzeile
 * oder an der nächsten bekannten Feldbeschriftung.
 */
function extractLabelledBlock(text: string, labelPattern: RegExp, maxLines = 6): string | undefined {
  const lines = text.split(/\r?\n/)
  const labelIndex = lines.findIndex((line) => labelPattern.test(line))
  if (labelIndex === -1) return undefined

  const collected: string[] = []

  // Steht hinter der Beschriftung in derselben Zeile bereits Text, mitnehmen.
  const sameLineRest = lines[labelIndex].replace(labelPattern, '').replace(/^[\s:–-]+/, '').trim()
  if (sameLineRest.length > 0) collected.push(sameLineRest)

  for (let i = labelIndex + 1; i < lines.length && collected.length < maxLines; i++) {
    const line = lines[i].trim()
    if (line === '') break
    if (FIELD_LABEL_PATTERN.test(line)) break
    collected.push(line)
  }

  if (collected.length === 0) return undefined
  return collected.join('\n')
}

export function extractDeliveryAddressBlock(text: string): string | undefined {
  return extractLabelledBlock(text, DELIVERY_LABELS)
}

export function extractOrderAddressBlock(text: string): string | undefined {
  return extractLabelledBlock(text, ORDER_LABELS)
}

/**
 * Empfängeradresse im Briefkopf: der letzte zusammenhängende Absatz vor dem
 * ersten bekannten Rechnungsfeld. Dient nur als letzte Rückfallebene.
 */
export function extractRecipientAddressBlock(text: string): string | undefined {
  const stopIndex = text.search(
    /Rechnung(?:s)?(?:nummer|-?\s?Nr\.?)|Rechnungsdatum|Lieferadresse|Auftragsadresse|Ihre\s+USt-?\s?IdNr/i,
  )
  const header = stopIndex > -1 ? text.slice(0, stopIndex) : text.slice(0, 600)

  const paragraphs = header
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  if (paragraphs.length === 0) return undefined
  // Der eigene Briefkopf steht typischerweise zuerst, die Empfängeradresse
  // als letzter Absatz davor.
  return paragraphs[paragraphs.length - 1]
}

export function parseAddress(block: string | undefined, kind: AddressKind): Address | undefined {
  if (!block) return undefined
  const detection = detectCountryFromAddress(block)
  return {
    kind,
    raw: block,
    countryToken: detection.token ?? undefined,
    countryCode: detection.code ?? undefined,
  }
}

/**
 * Bestimmt das Bestimmungsland gemäß Priorität:
 *  1. Lieferadresse
 *  2. Auftragsadresse
 *  3. Empfängeradresse im Briefkopf
 *
 * Ist im gewählten Adressblock kein Land eindeutig auflösbar, wird zusätzlich
 * eine dauerhaft gespeicherte manuelle Zuordnung für das gefundene Token
 * herangezogen. Erst danach gilt das Land als ungeklärt.
 */
export type DestinationCountryResult = {
  code: string | null
  source: 'delivery' | 'order' | 'recipient' | 'gespeichertes-mapping' | 'unresolved'
  token: string | null
  usedAddress?: Address
}

export function determineDestinationCountry(
  deliveryAddress: Address | undefined,
  orderAddress: Address | undefined,
  recipient: Address | undefined,
): DestinationCountryResult {
  const candidates: { address: Address | undefined; source: 'delivery' | 'order' | 'recipient' }[] = [
    { address: deliveryAddress, source: 'delivery' },
    { address: orderAddress, source: 'order' },
    { address: recipient, source: 'recipient' },
  ]

  const firstAvailable = candidates.find((c) => c.address)

  for (const candidate of candidates) {
    if (!candidate.address) continue
    if (candidate.address.countryCode) {
      return {
        code: candidate.address.countryCode,
        source: candidate.source,
        token: candidate.address.countryToken ?? null,
        usedAddress: candidate.address,
      }
    }
    // Kein automatisch auflösbares Land – gespeicherte Zuordnung prüfen.
    const mapped = lookupCountryMapping(candidate.address.countryToken ?? lastLineOf(candidate.address.raw))
    if (mapped) {
      return {
        code: mapped,
        source: 'gespeichertes-mapping',
        token: candidate.address.countryToken ?? lastLineOf(candidate.address.raw),
        usedAddress: candidate.address,
      }
    }
  }

  return {
    code: null,
    source: 'unresolved',
    token: firstAvailable?.address
      ? (firstAvailable.address.countryToken ?? lastLineOf(firstAvailable.address.raw))
      : null,
    usedAddress: firstAvailable?.address,
  }
}

function lastLineOf(block: string): string | null {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : null
}

/* ---------------------------------------------------------------- Positionen */

// Wichtig: innerhalb der Zahl NUR horizontale Trennzeichen erlauben. Ein `\s`
// würde den Zeilenumbruch mitfassen und Ziffern der nächsten Position
// anhängen (z. B. "39235000" + Positionsnummer "2" der Folgezeile).
const CUSTOMS_CODE_LABEL = /Zolltarif-?[ \t]?Nr\.?\.?[ \t]*:?[ \t]*\n?[ \t]*([0-9][0-9. \t]{4,12})(?![0-9])/gi
const QUANTITY_PATTERN = /([0-9][0-9.]*(?:,[0-9]+)?)\s*(?:Stück|Stueck|Stck\.?|Stk\.?|pcs)\b/i
const MONEY_PATTERN = /([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/g

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
    const anchorIndex = anchor.index ?? 0

    // Der Positionsblock reicht vom Ende der vorherigen Position bis zum Ende
    // dieser Position (Zolltarifnummer steht in der Regel unter dem Artikel).
    const blockStart = i === 0 ? Math.max(0, anchorIndex - 400) : (anchors[i - 1].index ?? 0) + (anchors[i - 1][0]?.length ?? 0)
    const blockEnd = anchorIndex + anchor[0].length
    const block = text.slice(blockStart, blockEnd)

    const customsCodeRaw = anchor[1].trim()
    const customsCode = customsCodeRaw.replace(/\D/g, '')

    const quantityMatch = block.match(QUANTITY_PATTERN)
    const quantityRaw = quantityMatch?.[1]
    const quantity = parseGermanNumber(quantityRaw ?? null) ?? undefined

    const productNameRaw = extractProductName(block, quantityMatch?.[0])

    const amountInfo = extractPositionAmount(block, quantityMatch?.[0])

    const isSpecialUnit = customsCode === '39233010'

    const negativeMarkers = /(Gutschrift|Storno(?:rechnung)?|Rabatt|Credit\s*note)/i
    const negativeReasonMatch = block.match(negativeMarkers)
    const isNegativeAmount = amountInfo?.value != null && amountInfo.value < 0
    const isCreditOrDiscountOrNegative = isNegativeAmount || !!negativeReasonMatch

    positions.push({
      id: `pos-${i + 1}-${customsCode || 'ohne'}`,
      lineNo: i + 1,
      productNameRaw,
      customsCodeRaw,
      customsCode,
      quantityRaw,
      quantity,
      amountRaw: amountInfo?.raw,
      amountEur: amountInfo?.value,
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

/**
 * Ermittelt die Produktbezeichnung innerhalb eines Positionsblocks.
 * Reihenfolge: ausdrückliche Beschriftung → Zeile mit/nach der Mengenangabe →
 * längste verbleibende Textzeile.
 */
function extractProductName(block: string, quantityText: string | undefined): string {
  const labelled = block.match(/Produkt(?:bezeichnung)?\s*:?\s*(.+)/i)
  if (labelled?.[1]) return labelled[1].trim()

  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const isCandidate = (line: string) =>
    !FIELD_LABEL_PATTERN.test(line) &&
    !/^\*+$/.test(line) &&
    // rein numerische Zeilen (Mengen, Beträge, Nummern) ausschließen
    !/^[0-9.,%\s€-]+$/.test(line) &&
    !/Zolltarif/i.test(line) &&
    line.length > 2

  if (quantityText) {
    const quantityLineIndex = lines.findIndex((line) => line.includes(quantityText.trim()))
    if (quantityLineIndex > -1) {
      // Reststück derselben Zeile hinter der Menge (z. B. "500,00 Stück  Sprayer K2 rot")
      const rest = lines[quantityLineIndex].split(quantityText.trim()).pop()?.trim() ?? ''
      if (rest.length > 2 && isCandidate(rest)) return rest

      // sonst die folgende Zeile
      for (let i = quantityLineIndex + 1; i < lines.length; i++) {
        if (isCandidate(lines[i])) return lines[i]
      }
    }
  }

  const candidates = lines.filter(isCandidate)
  if (candidates.length === 0) return ''
  return candidates.reduce((longest, line) => (line.length > longest.length ? line : longest), '')
}

/**
 * Liest den Positionsbetrag. Bevorzugt eine ausdrücklich beschriftete Angabe,
 * ansonsten den letzten Geldbetrag im Block (in tabellarischen Rechnungen
 * steht der Positionsbetrag rechts, also am Zeilenende).
 */
function extractPositionAmount(
  block: string,
  quantityText: string | undefined,
): { raw: string; value: number } | undefined {
  const labelled = block.match(/Betrag\s*:?\s*(-?[0-9][0-9.]*,[0-9]{2})/i)
  if (labelled) {
    const value = parseGermanNumber(labelled[1])
    if (value != null) return { raw: labelled[1], value }
  }

  const withoutQuantity = quantityText ? block.split(quantityText).join(' ') : block
  const matches = [...withoutQuantity.matchAll(MONEY_PATTERN)].map((m) => m[1])
  if (matches.length === 0) return undefined

  const raw = matches[matches.length - 1]
  const value = parseGermanNumber(raw)
  if (value == null) return undefined
  return { raw, value }
}

/* ------------------------------------------------------------ Gesamtergebnis */

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
  | 'orderAddress'
  | 'deliveryAddress'
  | 'positions'
>

export function parseInvoiceText(text: string): ParsedInvoiceFields {
  const invoiceDateRaw = extractInvoiceDate(text)
  const period = deriveReferencePeriod(invoiceDateRaw)
  const netWeight = extractNetWeightTotal(text)
  const vatId = extractVatId(text)

  const goodsValueTotalRaw = extractFirstMatch(
    text,
    /Warenwert(?:\s*gesamt|\s*insgesamt)?\s*:?\s*([0-9][0-9.,]*)\s*(?:EUR|€)?/i,
  )
  const freightCostRaw = extractFirstMatch(
    text,
    /(?:Frachtkosten|Fracht|Versandkosten|Freight)\s*:?\s*([0-9][0-9.,]*)\s*(?:EUR|€)?/i,
  )

  return {
    invoiceNumber: extractInvoiceNumber(text),
    invoiceDateRaw,
    referenceMonth: period?.month,
    referenceYear: period?.year,
    vatIdRaw: vatId,
    vatId,
    netWeightTotalRaw: netWeight?.raw,
    netWeightTotal: netWeight?.value,
    goodsValueTotalRaw,
    goodsValueTotal: extractGoodsValueTotal(text),
    freightCostRaw,
    freightCost: extractFreightCost(text),
    recipient: parseAddress(extractRecipientAddressBlock(text), 'recipient'),
    orderAddress: parseAddress(extractOrderAddressBlock(text), 'order'),
    deliveryAddress: parseAddress(extractDeliveryAddressBlock(text), 'delivery'),
    positions: extractPositions(text),
  }
}
