import type { Address, AddressKind, InvoiceLanguage, InvoicePosition } from '../types'
import { parseGermanNumber } from './germanNumber'
import { detectCountryFromAddress } from './countryCodes'
import { lookupCountryMapping, lookupAddressCountryOverride } from './mappingStore'
import {
  isBoldInteger,
  textRightOf,
  type DocumentText,
  type TextLine,
  type TextSegment,
} from './documentText'

/**
 * Parser für die Rechnungsfelder – auf Basis der fachlich bestätigten
 * Fundstellen:
 *
 *  - Rechnungsnummer: oben rechts fett neben "RECHNUNG" bzw. "INVOICE"
 *  - Rechnungsdatum: "vom:" bzw. englisch "dated:"; "Ihr Auftrag vom:" wird
 *    ausdrücklich ignoriert
 *  - Position: linksbündige fette Ganzzahl ("10", "20"); rechts davon beginnt
 *    die Artikelbezeichnung
 *  - Menge: ausschließlich die fett gesetzte Zahl (Preise stehen "per 100"
 *    und dürfen nicht als Menge gelesen werden)
 *  - Netto-Gesamtgewicht: Fußzeile hinter der Sternchenlinie, "Net weight:"
 *    bzw. "Netto:"
 *  - Flaschenartikel ("Zyl.", "Zylinderflasche", "FL", "Zylk.", "VK",
 *    "Vierkant"): Artikelgewicht steht in der Beschreibung ("Gew.:20 g") und
 *    wird nicht über die Gewichtsliste ermittelt
 *
 * Grundsatz: Wird ein Feld nicht eindeutig gefunden, bleibt es undefined –
 * es werden keine Werte geraten.
 */

/* ------------------------------------------------------------------ Sprache */

export function detectLanguage(text: string): InvoiceLanguage {
  let english = 0
  let german = 0
  if (/\bINVOICE\b/.test(text)) english += 2
  if (/\bdated\s*:/i.test(text)) english += 2
  if (/\bQuantity\b/i.test(text)) english += 1
  if (/\bDly\.?\s?date\b/i.test(text)) english += 1
  if (/\bNet\s*weight\b/i.test(text)) english += 1

  if (/\bRECHNUNG\b/.test(text)) german += 2
  if (/\bvom\s*:/i.test(text)) german += 2
  if (/\bMenge\b/.test(text)) german += 1
  if (/Zolltarif/i.test(text)) german += 1
  if (/\bNetto\b/.test(text)) german += 1

  return english > german ? 'en' : 'de'
}

/* --------------------------------------------------------- Rechnungsnummer */

const INVOICE_HEADING = /^(RECHNUNG|INVOICE)\b/i
const INVOICE_NUMBER_SHAPE = /^[0-9][0-9A-Za-z\-/]{2,}$/

/**
 * Liest die Rechnungsnummer aus dem fett gesetzten Text rechts neben der
 * Überschrift "RECHNUNG" bzw. "INVOICE".
 */
export function extractInvoiceNumber(doc: DocumentText): string | undefined {
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i]
    const headingSegment = line.segments.find((s) => INVOICE_HEADING.test(s.text.trim()))
    if (!headingSegment) continue

    const candidate = findInvoiceNumberSegment(line, headingSegment.x)
    if (candidate) return candidate

    // Nummer kann auch eine Zeile darunter stehen (gleiche Spalte rechts).
    for (const nextLine of doc.lines.slice(i + 1, i + 3)) {
      const next = findInvoiceNumberSegment(nextLine, headingSegment.x - 5)
      if (next) return next
    }
  }

  // Rückfallebene: ausdrücklich beschriftetes Feld
  const labelled = doc.text.match(
    /(?:Rechnung(?:s)?(?:nummer|-?\s?Nr\.?)|Invoice\s*(?:no\.?|number))\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)/i,
  )
  return labelled?.[1]?.trim()
}

function findInvoiceNumberSegment(line: TextLine, minX: number): string | undefined {
  const candidates = line.segments
    .filter((s) => s.x > minX)
    .flatMap((s) => s.text.split(/\s+/).map((token) => ({ token: token.trim(), bold: s.bold })))
    .filter((c) => c.token.length > 0)

  // Bevorzugt fett gesetzte Kandidaten (laut Vorgabe steht die Nummer fett).
  const bold = candidates.filter((c) => c.bold && INVOICE_NUMBER_SHAPE.test(c.token))
  if (bold.length > 0) return bold[0].token

  const any = candidates.filter((c) => INVOICE_NUMBER_SHAPE.test(c.token))
  return any.length > 0 ? any[0].token : undefined
}

/* ---------------------------------------------------------- Rechnungsdatum */

const DATE_PATTERN = /(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})/
const DATE_LABEL = /(?:\bvom\b|\bdated\b)\s*:?\s*/gi
const WRONG_DATE_CONTEXT =
  /(Auftrag|Bestellung|Lieferschein|Anfrage|Angebot|order|delivery\s*note|enquiry|quotation)/i

/**
 * Liest das Rechnungsdatum aus "vom:" (deutsch) bzw. "dated:" (englisch).
 * Felder mit anderem Bezug – etwa "Ihr Auftrag vom:" oder "your order
 * dated:" – werden ausgeschlossen.
 */
export function extractInvoiceDate(text: string): string | undefined {
  const candidates: { index: number; value: string }[] = []

  for (const match of text.matchAll(DATE_LABEL)) {
    const index = match.index ?? 0
    const contextBefore = text.slice(Math.max(0, index - 40), index)
    if (WRONG_DATE_CONTEXT.test(contextBefore)) continue

    const after = text.slice(index + match[0].length, index + match[0].length + 20)
    const dateMatch = after.match(DATE_PATTERN)
    if (!dateMatch) continue

    candidates.push({ index, value: dateMatch[1].replace(/\s/g, '') })
  }

  if (candidates.length === 0) return undefined

  // Bevorzugt das Feld nach der Rechnungsnummer / Rechnungsüberschrift.
  const anchor = text.search(/\b(RECHNUNG|INVOICE)\b|Rechnung(?:s)?(?:nummer|-?\s?Nr\.?)/i)
  if (anchor > -1) {
    const after = candidates.filter((c) => c.index > anchor)
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

/* ------------------------------------------------------------- Kopf-Felder */

export function extractVatId(text: string): string | undefined {
  const raw = text.match(
    /(?:Ihre\s+USt-?\s?IdNr\.?|Your\s+VAT\s*(?:-?\s?(?:ID|no\.?|number))?)\s*:?\s*([A-Za-z]{2}[A-Za-z0-9 ]*[A-Za-z0-9])/i,
  )
  return raw?.[1]?.replace(/\s+/g, '')
}

/**
 * Netto-Gesamtgewicht aus der Fußzeile hinter der Sternchen-Trennlinie
 * ("Net weight:" bzw. "Netto:"). Ein Netto-Geldbetrag wird über die
 * Einheitenprüfung ausgeschlossen.
 */
export function extractNetWeightTotal(text: string): { value: number; raw: string } | undefined {
  const afterStars = text.match(
    /\*{5,}[\s\S]{0,120}?(?:Net\s*weight|Nettogewicht|Netto)\s*:?\s*([0-9][0-9.,]*)\s*(kg|EUR|€)?/i,
  )
  if (afterStars && !/EUR|€/i.test(afterStars[2] ?? '')) {
    const value = parseGermanNumber(afterStars[1])
    if (value != null) return { value, raw: afterStars[1] }
  }

  const explicit = text.match(/Netto-?\s?Gesamtgewicht\s*:?\s*([0-9][0-9.,]*)\s*kg/i)
  if (explicit) {
    const value = parseGermanNumber(explicit[1])
    if (value != null) return { value, raw: explicit[1] }
  }

  for (const match of text.matchAll(
    /(?:Net\s*weight|Nettogewicht|Netto)\s*:?\s*([0-9][0-9.,]*)\s*(kg|EUR|€)?/gi,
  )) {
    if (/EUR|€/i.test(match[2] ?? '')) continue
    const value = parseGermanNumber(match[1])
    if (value != null) return { value, raw: match[1] }
  }

  return undefined
}

export function extractGoodsValueTotal(text: string): number | undefined {
  const raw = text.match(
    /(?:Warenwert(?:\s*gesamt|\s*insgesamt)?|Goods\s*value|Total\s*value)\s*:?\s*([0-9][0-9.,]*)\s*(?:EUR|€)?/i,
  )
  return parseGermanNumber(raw?.[1] ?? null) ?? undefined
}

export function extractFreightCost(text: string): number | undefined {
  const raw = text.match(
    /(?:Frachtkosten|Fracht|Versandkosten|Freight(?:\s*costs?)?|Carriage)\s*:?\s*([0-9][0-9.,]*)\s*(?:EUR|€)?/i,
  )
  return parseGermanNumber(raw?.[1] ?? null) ?? undefined
}

/* ------------------------------------------------------------------ Adressen */

const FIELD_LABEL_PATTERN =
  /^(RECHNUNG|INVOICE|Rechnungsnummer|Rechnungs-?Nr|Rechnungsdatum|vom\s*:|dated\s*:|Ihr\s+Auftrag|Your\s+order|Ihre\s+USt|Your\s+VAT|Kundennummer|Kunden-?Nr|Customer|Seite|Page|Pos\b|Position|Menge|Quantity|Bezeichnung|Description|Betrag|Amount|Dly\.?\s?date|Zolltarif|Customs|Lieferadresse|Auftragsadresse|Delivery\s+address|Zahlungsbedingungen|Lieferbedingungen|Terms)/i

const DELIVERY_LABELS = /(Lieferadresse|Liefer-?\s?Adresse|Lieferanschrift|Delivery\s+address|Ship-?to)/i
const ORDER_LABELS = /(Auftragsadresse|Auftrags-?\s?Adresse|Bestelladresse|Auftraggeber|Order(?:ing)?\s+address|Sold-?to)/i

function extractLabelledBlock(text: string, labelPattern: RegExp, maxLines = 6): string | undefined {
  const lines = text.split(/\r?\n/)
  const labelIndex = lines.findIndex((line) => labelPattern.test(line))
  if (labelIndex === -1) return undefined

  const collected: string[] = []
  const sameLineRest = lines[labelIndex].replace(labelPattern, '').replace(/^[\s:–-]+/, '').trim()
  if (sameLineRest.length > 0) collected.push(sameLineRest)

  for (let i = labelIndex + 1; i < lines.length && collected.length < maxLines; i++) {
    const line = lines[i].trim()
    if (line === '') break
    if (FIELD_LABEL_PATTERN.test(line)) break
    collected.push(line)
  }

  return collected.length > 0 ? collected.join('\n') : undefined
}

export function extractDeliveryAddressBlock(text: string): string | undefined {
  return extractLabelledBlock(text, DELIVERY_LABELS)
}

export function extractOrderAddressBlock(text: string): string | undefined {
  return extractLabelledBlock(text, ORDER_LABELS)
}

export function extractRecipientAddressBlock(text: string): string | undefined {
  const stopIndex = text.search(
    /\b(RECHNUNG|INVOICE)\b|Rechnung(?:s)?(?:nummer|-?\s?Nr\.?)|Rechnungsdatum|Lieferadresse|Auftragsadresse|Delivery\s+address|Ihre\s+USt-?\s?IdNr/i,
  )
  const header = stopIndex > -1 ? text.slice(0, stopIndex) : text.slice(0, 600)

  const paragraphs = header
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  return paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : undefined
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

export type DestinationCountrySource =
  | 'delivery'
  | 'order'
  | 'recipient'
  | 'gelernte-zuordnung'
  | 'gespeichertes-mapping'
  | 'unresolved'

export type DestinationCountryResult = {
  code: string | null
  source: DestinationCountrySource
  token: string | null
  usedAddress?: Address
  /** true, wenn der Code nur ein Vorschlag ist und bestätigt werden muss. */
  needsConfirmation: boolean
}

function lastLineOf(block: string): string | null {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : null
}

/**
 * Bestimmt das Bestimmungsland: Lieferadresse vor Auftragsadresse vor
 * Empfängeradresse. Kann das Kennzeichen nicht aufgelöst werden, greift eine
 * dauerhaft gespeicherte Zuordnung. Bleibt es unklar, wird – sofern in einer
 * der Adressen überhaupt ein Land erkennbar war – dieses als **Vorschlag**
 * geliefert und zur Bestätigung markiert.
 */
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

  const available = candidates.filter((c) => c.address)

  // 1. Gelernte Zuordnung für genau diese Adresse hat Vorrang – so werden
  //    zuvor manuell bestätigte Abweichungen künftig automatisch angewendet.
  for (const candidate of available) {
    const address = candidate.address!
    const learned = lookupAddressCountryOverride(address.raw)
    if (learned) {
      return {
        code: learned,
        source: 'gelernte-zuordnung',
        token: address.countryToken ?? lastLineOf(address.raw),
        usedAddress: address,
        needsConfirmation: false,
      }
    }
  }

  // 2. Die höchstpriorisierte vorhandene Adresse ist maßgeblich.
  const primaryCandidate = available[0]
  const primary = primaryCandidate?.address

  if (primary) {
    if (primary.countryCode) {
      return {
        code: primary.countryCode,
        source: primaryCandidate.source,
        token: primary.countryToken ?? null,
        usedAddress: primary,
        // Aus dem Briefkopf abgeleitete Länder gelten nur als Vorschlag.
        needsConfirmation: primaryCandidate.source === 'recipient',
      }
    }

    const mapped = lookupCountryMapping(primary.countryToken ?? lastLineOf(primary.raw))
    if (mapped) {
      return {
        code: mapped,
        source: 'gespeichertes-mapping',
        token: primary.countryToken ?? lastLineOf(primary.raw),
        usedAddress: primary,
        needsConfirmation: false,
      }
    }
  }

  // 3. In der maßgeblichen Adresse ist kein Land erkennbar: Land einer
  //    nachrangigen Adresse als Vorschlag anbieten (muss bestätigt werden).
  const fallback = available.slice(1).find((c) => c.address?.countryCode)
  if (fallback?.address?.countryCode) {
    return {
      code: fallback.address.countryCode,
      source: fallback.source,
      token: primary ? (primary.countryToken ?? lastLineOf(primary.raw)) : null,
      usedAddress: primary ?? fallback.address,
      needsConfirmation: true,
    }
  }

  return {
    code: null,
    source: 'unresolved',
    token: primary ? (primary.countryToken ?? lastLineOf(primary.raw)) : null,
    usedAddress: primary,
    needsConfirmation: true,
  }
}

/* ---------------------------------------------------------------- Positionen */

const CUSTOMS_CODE_PATTERN =
  /(?:Zolltarif-?[ \t]?Nr\.?\.?|Customs\s*tariff(?:\s*no\.?)?|Commodity\s*code|Tariff\s*no\.?|HS[- ]?code)[ \t]*:?[ \t]*\n?[ \t]*([0-9][0-9. \t]{4,12})(?![0-9])/i

const QUANTITY_UNIT = /(St(?:ü|ue)ck|Stck\.?|Stk\.?|pcs\.?|pieces|pc\.?)/i
const NUMBER_SHAPE = /^-?[0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]+)?$|^-?[0-9]+(?:,[0-9]+)?$/
const MONEY_SHAPE = /^-?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}$|^-?[0-9]+,[0-9]{2}$/
const DATE_SHAPE = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/
const FOOTER_MARKER = /\*{5,}/

export type PositionColumns = {
  quantityX?: number
  descriptionX?: number
  amountX?: number
}

/**
 * Ermittelt die x-Positionen der Tabellenspalten aus der Kopfzeile der
 * Positionstabelle. Dadurch lässt sich der Positionsbetrag unabhängig von
 * seiner Beschriftung finden – in englischen Rechnungen trägt diese Spalte
 * laut Vorgabe die Bezeichnung "Dly.date".
 */
export function detectPositionColumns(doc: DocumentText): PositionColumns {
  const columns: PositionColumns = {}

  for (const line of doc.lines) {
    const hasQuantity = /\b(Menge|Quantity)\b/i.test(line.text)
    const hasAmount = /\b(Betrag|Amount|Dly\.?\s?date|Total|Wert|Value)\b/i.test(line.text)
    if (!hasQuantity && !hasAmount) continue

    for (const segment of line.segments) {
      if (/\b(Menge|Quantity)\b/i.test(segment.text) && columns.quantityX == null) {
        columns.quantityX = segment.x
      }
      if (/\b(Bezeichnung|Description|Artikel|Article)\b/i.test(segment.text) && columns.descriptionX == null) {
        columns.descriptionX = segment.x
      }
      if (
        /\b(Betrag|Amount|Dly\.?\s?date|Total|Wert|Value)\b/i.test(segment.text) &&
        columns.amountX == null
      ) {
        columns.amountX = segment.x
      }
    }
    if (columns.quantityX != null || columns.amountX != null) break
  }

  return columns
}

type PositionAnchor = { lineIndex: number; segment: TextSegment; number: number }

/**
 * Findet die Positionszeilen: linksbündige, fett gesetzte Ganzzahlen
 * ("10", "20", …). Es werden nur aufsteigende Nummern in derselben Spalte
 * akzeptiert, damit andere fette Zahlen nicht fehlinterpretiert werden.
 */
export function findPositionAnchors(doc: DocumentText): PositionAnchor[] {
  const raw: PositionAnchor[] = []

  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i]
    const first = line.segments[0]
    if (!first || !isBoldInteger(first)) continue
    raw.push({ lineIndex: i, segment: first, number: Number(first.text.trim()) })
  }

  if (raw.length === 0) return []

  // Auf die linke Spalte beschränken
  const minX = Math.min(...raw.map((a) => a.segment.x))
  const inColumn = raw.filter((a) => a.segment.x <= minX + 8)

  // Nur aufsteigende Positionsnummern behalten
  const ascending: PositionAnchor[] = []
  for (const anchor of inColumn) {
    if (ascending.length === 0 || anchor.number > ascending[ascending.length - 1].number) {
      ascending.push(anchor)
    }
  }

  return ascending
}

function segmentTokens(line: TextLine): { token: string; bold: boolean; x: number; endX: number }[] {
  return line.segments.flatMap((segment) => {
    const parts = segment.text.split(/\s+/).filter(Boolean)
    if (parts.length <= 1) {
      return [{ token: segment.text.trim(), bold: segment.bold, x: segment.x, endX: segment.endX }]
    }
    const width = Math.max(segment.endX - segment.x, 1)
    const totalChars = segment.text.length || 1
    let cursor = 0
    return parts.map((part) => {
      const start = segment.text.indexOf(part, cursor)
      cursor = start + part.length
      return {
        token: part,
        bold: segment.bold,
        x: segment.x + (start / totalChars) * width,
        endX: segment.x + (cursor / totalChars) * width,
      }
    })
  })
}

/**
 * Zerlegt die Rechnung in Positionsblöcke und liest je Position
 * Bezeichnung, Menge (fett), Warennummer und Betrag.
 */
export function extractPositions(doc: DocumentText, columns: PositionColumns = {}): InvoicePosition[] {
  const anchors = findPositionAnchors(doc)
  if (anchors.length === 0) return []

  const footerIndex = doc.lines.findIndex((line) => FOOTER_MARKER.test(line.text))

  const positions: InvoicePosition[] = []

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]
    const nextAnchorIndex = i + 1 < anchors.length ? anchors[i + 1].lineIndex : doc.lines.length
    const limit = footerIndex > anchor.lineIndex ? Math.min(nextAnchorIndex, footerIndex) : nextAnchorIndex
    const blockLines = doc.lines.slice(anchor.lineIndex, limit)
    const blockText = blockLines.map((l) => l.text).join('\n')

    // --- Warennummer
    const customsMatch = blockText.match(CUSTOMS_CODE_PATTERN)
    const customsCodeRaw = customsMatch?.[1]?.trim()
    const customsCode = customsCodeRaw?.replace(/\D/g, '')

    // --- Menge: ausschließlich fett gesetzte Zahlen
    const quantity = extractQuantity(blockLines, anchor.segment)

    // --- Bezeichnung: rechts von der Positionsnummer, über die Folgezeilen
    const productNameRaw = extractDescription(blockLines, anchor, columns)

    // --- Betrag
    const amount = extractAmount(blockLines, anchor.segment, quantity?.segmentX, columns)

    const isSpecialUnit = customsCode === '39233010'
    const negativeMarkers = /(Gutschrift|Storno(?:rechnung)?|Rabatt|Credit\s*note|discount)/i
    const negativeReasonMatch = blockText.match(negativeMarkers)
    const isNegativeAmount = amount?.value != null && amount.value < 0
    const isCreditOrDiscountOrNegative = isNegativeAmount || !!negativeReasonMatch

    positions.push({
      id: `pos-${i + 1}-${anchor.number}`,
      lineNo: i + 1,
      positionNumber: anchor.segment.text.trim(),
      productNameRaw,
      customsCodeRaw,
      customsCode,
      quantityRaw: quantity?.raw,
      quantity: quantity?.value,
      amountRaw: amount?.raw,
      amountEur: amount?.value,
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

function extractQuantity(
  blockLines: TextLine[],
  positionSegment: TextSegment,
): { value: number; raw: string; segmentX: number } | undefined {
  const boldNumbers: { token: string; x: number }[] = []

  for (const line of blockLines) {
    const tokens = segmentTokens(line)
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (!t.bold) continue
      if (t.x === positionSegment.x && t.token === positionSegment.text.trim()) continue
      if (DATE_SHAPE.test(t.token)) continue
      if (!NUMBER_SHAPE.test(t.token)) continue

      // Mit unmittelbar folgender Mengeneinheit hat Vorrang
      const following = tokens.slice(i + 1, i + 3).map((n) => n.token).join(' ')
      if (QUANTITY_UNIT.test(following) || QUANTITY_UNIT.test(t.token)) {
        const value = parseGermanNumber(t.token)
        if (value != null) return { value, raw: t.token, segmentX: t.x }
      }
      boldNumbers.push({ token: t.token, x: t.x })
    }
  }

  for (const candidate of boldNumbers) {
    const value = parseGermanNumber(candidate.token)
    if (value != null) return { value, raw: candidate.token, segmentX: candidate.x }
  }

  return undefined
}

function extractDescription(
  blockLines: TextLine[],
  anchor: PositionAnchor,
  columns: PositionColumns,
): string {
  const leftBoundary = anchor.segment.endX

  // Rechte Grenze der Bezeichnungsspalte: die nächste Zahlenspalte rechts.
  const columnEdges = [columns.quantityX, columns.amountX]
    .filter((x): x is number => x != null && x > leftBoundary)
    .sort((a, b) => a - b)
  const rightBoundary = columnEdges[0] ?? Number.POSITIVE_INFINITY

  const parts: string[] = []

  // Erste Zeile: alles rechts von der Positionsnummer
  const firstLineText = textRightOf(blockLines[0], anchor.segment.x)
  if (firstLineText) parts.push(firstLineText)

  // Folgezeilen: nur Textfragmente der Bezeichnungsspalte
  for (const line of blockLines.slice(1)) {
    const text = line.segments
      .filter((s) => s.x >= leftBoundary - 4 && s.x < rightBoundary)
      // Mengen sind fett gesetzt und gehören nicht zur Bezeichnung
      .filter((s) => !s.bold)
      .filter((s) => {
        const value = s.text.trim()
        if (NUMBER_SHAPE.test(value) || MONEY_SHAPE.test(value)) return false
        if (new RegExp(`^[0-9][0-9.,]*\\s*${QUANTITY_UNIT.source}$`, 'i').test(value)) return false
        return !FIELD_LABEL_PATTERN.test(value)
      })
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 1) parts.push(text)
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function extractAmount(
  blockLines: TextLine[],
  positionSegment: TextSegment,
  quantityX: number | undefined,
  columns: PositionColumns,
): { value: number; raw: string } | undefined {
  const candidates: { token: string; x: number }[] = []

  for (const line of blockLines) {
    for (const t of segmentTokens(line)) {
      const token = t.token
      if (DATE_SHAPE.test(token)) continue
      if (!MONEY_SHAPE.test(token)) continue
      if (t.x === positionSegment.x) continue
      if (quantityX != null && Math.abs(t.x - quantityX) < 1) continue
      candidates.push({ token, x: t.x })
    }
  }

  if (candidates.length === 0) return undefined

  // Mit bekannter Betragsspalte: den nächstgelegenen Wert nehmen.
  if (columns.amountX != null) {
    const nearest = candidates.reduce((best, current) =>
      Math.abs(current.x - columns.amountX!) < Math.abs(best.x - columns.amountX!) ? current : best,
    )
    const value = parseGermanNumber(nearest.token)
    if (value != null) return { value, raw: nearest.token }
  }

  // Sonst: der am weitesten rechts stehende Betrag (Betragsspalte steht rechts).
  const rightmost = candidates.reduce((best, current) => (current.x > best.x ? current : best))
  const value = parseGermanNumber(rightmost.token)
  return value != null ? { value, raw: rightmost.token } : undefined
}

/* ------------------------------------------------------------ Gesamtergebnis */

export type ParsedInvoiceFields = {
  language: InvoiceLanguage
  invoiceNumber?: string
  invoiceDateRaw?: string
  referenceMonth?: string
  referenceYear?: string
  vatIdRaw?: string
  vatId?: string
  netWeightTotalRaw?: string
  netWeightTotal?: number
  goodsValueTotalRaw?: string
  goodsValueTotal?: number
  freightCostRaw?: string
  freightCost?: number
  recipient?: Address
  orderAddress?: Address
  deliveryAddress?: Address
  positions: InvoicePosition[]
}

export function parseInvoiceDocument(doc: DocumentText): ParsedInvoiceFields {
  const text = doc.text
  const language = detectLanguage(text)
  const invoiceDateRaw = extractInvoiceDate(text)
  const period = deriveReferencePeriod(invoiceDateRaw)
  const netWeight = extractNetWeightTotal(text)
  const vatId = extractVatId(text)
  const columns = detectPositionColumns(doc)

  return {
    language,
    invoiceNumber: extractInvoiceNumber(doc),
    invoiceDateRaw,
    referenceMonth: period?.month,
    referenceYear: period?.year,
    vatIdRaw: vatId,
    vatId,
    netWeightTotalRaw: netWeight?.raw,
    netWeightTotal: netWeight?.value,
    goodsValueTotal: extractGoodsValueTotal(text),
    freightCost: extractFreightCost(text),
    recipient: parseAddress(extractRecipientAddressBlock(text), 'recipient'),
    orderAddress: parseAddress(extractOrderAddressBlock(text), 'order'),
    deliveryAddress: parseAddress(extractDeliveryAddressBlock(text), 'delivery'),
    positions: extractPositions(doc, columns),
  }
}
