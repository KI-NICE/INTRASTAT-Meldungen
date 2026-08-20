// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractInvoiceNumber,
  extractInvoiceDate,
  deriveReferencePeriod,
  extractVatId,
  extractNetWeightTotal,
  extractPositions,
  detectPositionColumns,
  detectLanguage,
  findPositionAnchors,
  extractDeliveryAddressBlock,
  extractOrderAddressBlock,
  parseAddress,
  parseInvoiceDocument,
  determineDestinationCountry,
} from '../invoiceParser'
import { clearCountryMappings, saveCountryMapping, saveAddressCountryOverride } from '../mappingStore'
import { buildDocument, type LineSpec } from './helpers'

/**
 * Synthetische Beispielrechnung im Layout der echten Rechnungen
 * (keine echten Kunden- oder Rechnungsdaten):
 *
 *  - Rechnungsnummer oben rechts fett neben "RECHNUNG"
 *  - Rechnungsdatum in "vom:", daneben das irreführende "Ihr Auftrag vom:"
 *  - Positionsnummern linksbündig fett ("10", "20")
 *  - Mengen fett; Preise stehen "per 100" und dürfen nicht als Menge gelten
 *  - Position 20 ist ein Flaschenartikel mit Gewicht in der Beschreibung
 */
const X_POS = 50
const X_DESC = 90
const X_QTY = 250
const X_PRICE = 350
const X_AMOUNT = 450

const GERMAN_INVOICE: LineSpec[] = [
  [['Muster Verpackung GmbH', X_POS], ['RECHNUNG', 380, true], ['4711-2026', 470, true]],
  [['Industriestr. 1', X_POS]],
  [['D-70173 Stuttgart', X_POS], ['vom: 05.08.2026', 380]],
  [['Ihr Auftrag vom: 15.07.2026', 380]],
  'BLANK',
  [['Beispiel Kunde AG', X_POS]],
  [['Rue de la Paix 5', X_POS]],
  [['B-1000 Bruessel', X_POS]],
  'BLANK',
  [['Auftragsadresse:', X_POS]],
  [['Beispiel Kunde AG', X_POS]],
  [['Rue de la Paix 5', X_POS]],
  [['B-1000 Bruessel', X_POS]],
  'BLANK',
  [['Lieferadresse:', X_POS]],
  [['Beispiel Kunde Werk Nord', X_POS]],
  [['Handelskaai 12', X_POS]],
  [['A-1010 Wien', X_POS]],
  'BLANK',
  [['Ihre USt-IdNr.: BE 0123456789', X_POS]],
  'BLANK',
  [['Pos', X_POS], ['Bezeichnung', X_DESC], ['Menge', X_QTY], ['Preis/100', X_PRICE], ['Betrag', X_AMOUNT]],
  [['10', X_POS, true], ['Sprayer K2 rot mit Kappe 28/410', X_DESC]],
  [['1000 Stück', X_QTY, true], ['12,50', X_PRICE], ['125,00', X_AMOUNT]],
  [['Zolltarif-Nr.: 39235000', X_DESC]],
  [['20', X_POS, true], ['Zyl.Flasche 250 ml natur Gew.:20 g', X_DESC]],
  [['252 Stück', X_QTY, true], ['30,00', X_PRICE], ['75,60', X_AMOUNT]],
  [['Zolltarif-Nr..: 39233010', X_DESC]],
  'BLANK',
  [['**************************************************', X_POS]],
  [['Net weight: 56,00 kg', X_POS]],
]

const ENGLISH_INVOICE: LineSpec[] = [
  [['Muster Verpackung GmbH', X_POS], ['INVOICE', 380, true], ['4712-2026', 470, true]],
  [['D-70173 Stuttgart', X_POS], ['dated: 06.08.2026', 380]],
  [['your order dated: 10.07.2026', 380]],
  'BLANK',
  [['Delivery address:', X_POS]],
  [['Example Customer Ltd', X_POS]],
  [['Handelskaai 12', X_POS]],
  [['B-2000 Antwerpen', X_POS]],
  'BLANK',
  [['Your VAT-ID: BE 0123456789', X_POS]],
  'BLANK',
  [['Pos', X_POS], ['Description', X_DESC], ['Quantity', X_QTY], ['Price/100', X_PRICE], ['Dly.date', X_AMOUNT]],
  [['10', X_POS, true], ['Sprayer K3 blue', X_DESC]],
  [['200 pcs', X_QTY, true], ['10,00', X_PRICE], ['20,00', X_AMOUNT]],
  [['Customs tariff no.: 39235000', X_DESC]],
  'BLANK',
  [['**************************************************', X_POS]],
  [['Net weight: 7,00 kg', X_POS]],
]

const german = buildDocument(GERMAN_INVOICE)
const english = buildDocument(ENGLISH_INVOICE)

beforeEach(() => {
  clearCountryMappings()
})

describe('Sprache', () => {
  it('erkennt deutsche und englische Rechnungen', () => {
    expect(detectLanguage(german.text)).toBe('de')
    expect(detectLanguage(english.text)).toBe('en')
  })
})

describe('Rechnungsnummer', () => {
  it('liest die fette Nummer rechts neben "RECHNUNG"', () => {
    expect(extractInvoiceNumber(german)).toBe('4711-2026')
  })

  it('liest die fette Nummer rechts neben "INVOICE"', () => {
    expect(extractInvoiceNumber(english)).toBe('4712-2026')
  })
})

describe('Rechnungsdatum', () => {
  it('liest "vom:" und ignoriert "Ihr Auftrag vom:"', () => {
    expect(extractInvoiceDate(german.text)).toBe('05.08.2026')
  })

  it('liest englisch "dated:" und ignoriert "your order dated:"', () => {
    expect(extractInvoiceDate(english.text)).toBe('06.08.2026')
  })

  it('gibt undefined zurück, wenn nur ein Auftragsdatum vorhanden ist', () => {
    expect(extractInvoiceDate('Ihr Auftrag vom: 15.07.2026')).toBeUndefined()
    expect(extractInvoiceDate('your order dated: 10.07.2026')).toBeUndefined()
  })

  it('leitet den Bezugsmonat aus dem Rechnungsdatum ab', () => {
    expect(deriveReferencePeriod('05.08.2026')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod('5.8.26')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod(undefined)).toBeUndefined()
  })
})

describe('Kopf-Felder', () => {
  it('bereinigt die USt-IdNr. von Leerzeichen (deutsch und englisch)', () => {
    expect(extractVatId(german.text)).toBe('BE0123456789')
    expect(extractVatId(english.text)).toBe('BE0123456789')
  })

  it('liest das Netto-Gesamtgewicht hinter der Sternchenlinie', () => {
    expect(extractNetWeightTotal(german.text)?.value).toBeCloseTo(56)
    expect(extractNetWeightTotal(english.text)?.value).toBeCloseTo(7)
  })

  it('verwechselt einen Netto-Geldbetrag nicht mit dem Gewicht', () => {
    expect(extractNetWeightTotal('Netto: 1.250,00 EUR')).toBeUndefined()
  })
})

describe('Spalten und Positionen', () => {
  it('erkennt die Spaltenpositionen aus der Tabellenkopfzeile', () => {
    const columns = detectPositionColumns(german)
    expect(columns.quantityX).toBe(X_QTY)
    expect(columns.amountX).toBe(X_AMOUNT)
  })

  it('erkennt die englische Betragsspalte "Dly.date"', () => {
    const columns = detectPositionColumns(english)
    expect(columns.quantityX).toBe(X_QTY)
    expect(columns.amountX).toBe(X_AMOUNT)
  })

  it('findet die Positionen über die linksbündigen fetten Nummern', () => {
    const anchors = findPositionAnchors(german)
    expect(anchors.map((a) => a.segment.text)).toEqual(['10', '20'])
  })

  it('liest Bezeichnung, Menge, Warennummer und Betrag je Position', () => {
    const positions = extractPositions(german, detectPositionColumns(german))
    expect(positions).toHaveLength(2)

    expect(positions[0].positionNumber).toBe('10')
    expect(positions[0].productNameRaw).toBe('Sprayer K2 rot mit Kappe 28/410')
    expect(positions[0].quantity).toBe(1000)
    expect(positions[0].customsCode).toBe('39235000')
    expect(positions[0].amountEur).toBeCloseTo(125)
    expect(positions[0].isSpecialUnit).toBe(false)

    expect(positions[1].positionNumber).toBe('20')
    expect(positions[1].productNameRaw).toContain('Gew.:20 g')
    expect(positions[1].quantity).toBe(252)
    expect(positions[1].customsCode).toBe('39233010')
    expect(positions[1].amountEur).toBeCloseTo(75.6)
    expect(positions[1].isSpecialUnit).toBe(true)
  })

  it('nimmt den Preis (per 100) nicht als Menge, weil er nicht fett ist', () => {
    const positions = extractPositions(german, detectPositionColumns(german))
    expect(positions[0].quantity).not.toBe(12.5)
    expect(positions[1].quantity).not.toBe(30)
  })

  it('nimmt den Preis nicht als Positionsbetrag, sondern den Wert der Betragsspalte', () => {
    const positions = extractPositions(german, detectPositionColumns(german))
    expect(positions[0].amountEur).not.toBeCloseTo(12.5)
    expect(positions[1].amountEur).not.toBeCloseTo(30)
  })

  it('verarbeitet englische Positionen (Quantity in "pcs")', () => {
    const positions = extractPositions(english, detectPositionColumns(english))
    expect(positions).toHaveLength(1)
    expect(positions[0].productNameRaw).toBe('Sprayer K3 blue')
    expect(positions[0].quantity).toBe(200)
    expect(positions[0].customsCode).toBe('39235000')
    expect(positions[0].amountEur).toBeCloseTo(20)
  })

  it('nimmt die Bezeichnung aus dem Bereich rechts der Positionsnummer', () => {
    const positions = extractPositions(german, detectPositionColumns(german))
    expect(positions[0].productNameRaw).not.toContain('Stück')
    expect(positions[0].productNameRaw).not.toContain('Zolltarif')
  })
})

describe('Adressen und Bestimmungsland', () => {
  it('findet Lieferadress- und Auftragsadressblock', () => {
    expect(extractDeliveryAddressBlock(german.text)).toContain('Handelskaai 12')
    expect(extractOrderAddressBlock(german.text)).toContain('Rue de la Paix 5')
  })

  it('übersetzt das Länderkennzeichen der Lieferadresse ("A" → "AT")', () => {
    const delivery = parseAddress(extractDeliveryAddressBlock(german.text), 'delivery')
    expect(delivery?.countryToken).toBe('A')
    expect(delivery?.countryCode).toBe('AT')
  })

  it('gibt der Lieferadresse Vorrang vor der Auftragsadresse', () => {
    const result = determineDestinationCountry(
      parseAddress(extractDeliveryAddressBlock(german.text), 'delivery'),
      parseAddress(extractOrderAddressBlock(german.text), 'order'),
      undefined,
    )
    expect(result.code).toBe('AT')
    expect(result.source).toBe('delivery')
    expect(result.needsConfirmation).toBe(false)
  })

  it('nutzt die Auftragsadresse, wenn keine Lieferadresse vorhanden ist', () => {
    const order = parseAddress('Beispiel Kunde AG\nRue de la Paix 5\nB-1000 Bruessel', 'order')
    const result = determineDestinationCountry(undefined, order, undefined)
    expect(result.code).toBe('BE')
    expect(result.source).toBe('order')
  })

  it('schlägt bei unklarer Lieferadresse das Land einer anderen Adresse vor', () => {
    const delivery = parseAddress('Werk Nord\nHafenstrasse 3\n12345 Irgendwo', 'delivery')
    const order = parseAddress('Kunde AG\nRue 5\nB-1000 Bruessel', 'order')
    const result = determineDestinationCountry(delivery, order, undefined)
    expect(result.code).toBe('BE')
    expect(result.needsConfirmation).toBe(true)
  })

  it('lässt das Land ungeklärt, wenn nirgends etwas erkennbar ist', () => {
    const order = parseAddress('Kunde AG\nSome Street 5\n12345 Somewhere', 'order')
    const result = determineDestinationCountry(undefined, order, undefined)
    expect(result.code).toBeNull()
    expect(result.needsConfirmation).toBe(true)
  })

  it('verwendet eine gespeicherte Kennzeichen-Zuordnung', () => {
    saveCountryMapping('XY', 'IT')
    const order = parseAddress('Kunde AG\nVia Roma 1\nXY-00100 Roma', 'order')
    const result = determineDestinationCountry(undefined, order, undefined)
    expect(result.code).toBe('IT')
    expect(result.source).toBe('gespeichertes-mapping')
  })

  it('gelernte Adress-Zuordnungen haben Vorrang vor der automatischen Erkennung', () => {
    const block = 'Beispiel Kunde Werk Nord\nHandelskaai 12\nA-1010 Wien'
    saveAddressCountryOverride(block, 'DE')
    const delivery = parseAddress(block, 'delivery')
    const result = determineDestinationCountry(delivery, undefined, undefined)
    expect(result.code).toBe('DE')
    expect(result.source).toBe('gelernte-zuordnung')
    expect(result.needsConfirmation).toBe(false)
  })
})

describe('Gesamtergebnis', () => {
  it('liefert alle Kopf- und Positionsdaten der deutschen Rechnung', () => {
    const parsed = parseInvoiceDocument(german)
    expect(parsed.language).toBe('de')
    expect(parsed.invoiceNumber).toBe('4711-2026')
    expect(parsed.invoiceDateRaw).toBe('05.08.2026')
    expect(parsed.referenceMonth).toBe('08')
    expect(parsed.referenceYear).toBe('2026')
    expect(parsed.vatId).toBe('BE0123456789')
    expect(parsed.netWeightTotal).toBeCloseTo(56)
    expect(parsed.positions).toHaveLength(2)
    expect(parsed.deliveryAddress?.countryCode).toBe('AT')
  })
})
