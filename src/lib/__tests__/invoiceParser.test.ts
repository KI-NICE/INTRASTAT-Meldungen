// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractInvoiceNumber,
  extractInvoiceDate,
  deriveReferencePeriod,
  extractVatId,
  extractNetWeightTotal,
  extractPositions,
  extractDeliveryAddressBlock,
  extractOrderAddressBlock,
  parseAddress,
  determineDestinationCountry,
} from '../invoiceParser'
import { clearCountryMappings, saveCountryMapping } from '../mappingStore'

/**
 * Synthetische Beispielrechnung – enthält bewusst die fachlich bestätigten
 * Fundstellen: "vom:" unter der Rechnungsnummer, ein irreführendes
 * "Ihr Auftrag vom:", Länderkennzeichen in der Adresse, Mengen im Format
 * "#.###,## Stück" und das Netto-Gesamtgewicht hinter der Sternchenlinie.
 */
const SAMPLE_INVOICE = `Muster Verpackung GmbH
Industriestr. 1
D-70173 Stuttgart

Beispiel Kunde AG
Rue de la Paix 5
B-1000 Bruessel

Auftragsadresse:
Beispiel Kunde AG
Rue de la Paix 5
B-1000 Bruessel

Lieferadresse:
Beispiel Kunde Werk Nord
Handelskaai 12
A-1010 Wien

Rechnungsnummer: 2026-08-0001
vom: 05.08.2026
Ihr Auftrag vom: 15.07.2026
Ihre USt-IdNr.: BE 0123456789

Pos Menge Bezeichnung Einzelpreis Betrag
1
500,00 Stück
Sprayer K2 rot mit Kappe
2,50 1.250,00
Zolltarif-Nr.: 39235000

2
1.000,00 Stück
Sicherheitsverschluss weiss
0,45 450,00
Zolltarif-Nr..: 39233010

**************************************************
Net weight: 32,00 kg
`

beforeEach(() => {
  clearCountryMappings()
})

describe('Rechnungskopf', () => {
  it('liest die Rechnungsnummer', () => {
    expect(extractInvoiceNumber(SAMPLE_INVOICE)).toBe('2026-08-0001')
  })

  it('liest das Rechnungsdatum aus "vom:" und ignoriert "Ihr Auftrag vom:"', () => {
    expect(extractInvoiceDate(SAMPLE_INVOICE)).toBe('05.08.2026')
  })

  it('ignoriert "Ihr Auftrag vom:" auch, wenn es zuerst im Text steht', () => {
    const text = 'Ihr Auftrag vom: 15.07.2026\nRechnungsnummer: 1\nvom: 05.08.2026'
    expect(extractInvoiceDate(text)).toBe('05.08.2026')
  })

  it('gibt undefined zurück, wenn nur ein Auftragsdatum vorhanden ist', () => {
    expect(extractInvoiceDate('Ihr Auftrag vom: 15.07.2026')).toBeUndefined()
  })

  it('leitet den Bezugsmonat aus dem Rechnungsdatum ab', () => {
    expect(deriveReferencePeriod('05.08.2026')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod('5.8.26')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod(undefined)).toBeUndefined()
  })

  it('bereinigt die USt-IdNr. von Leerzeichen', () => {
    expect(extractVatId(SAMPLE_INVOICE)).toBe('BE0123456789')
  })
})

describe('Netto-Gesamtgewicht', () => {
  it('liest den Wert hinter der Sternchen-Trennlinie ("Net weight:")', () => {
    expect(extractNetWeightTotal(SAMPLE_INVOICE)?.value).toBeCloseTo(32)
  })

  it('liest auch die deutsche Variante ("Netto:")', () => {
    const text = '**************************************************\nNetto: 1.234,50 kg'
    expect(extractNetWeightTotal(text)?.value).toBeCloseTo(1234.5)
  })

  it('verwechselt einen Netto-Geldbetrag nicht mit dem Gewicht', () => {
    const text = 'Netto: 1.250,00 EUR\nMwSt: 237,50 EUR'
    expect(extractNetWeightTotal(text)).toBeUndefined()
  })
})

describe('Positionen', () => {
  it('erkennt beide Positionen mit Warennummer, Menge und Betrag', () => {
    const positions = extractPositions(SAMPLE_INVOICE)
    expect(positions).toHaveLength(2)

    expect(positions[0].customsCode).toBe('39235000')
    expect(positions[0].quantity).toBe(500)
    expect(positions[0].amountEur).toBeCloseTo(1250)
    expect(positions[0].productNameRaw).toContain('Sprayer K2')
    expect(positions[0].isSpecialUnit).toBe(false)

    expect(positions[1].customsCode).toBe('39233010')
    expect(positions[1].quantity).toBe(1000)
    expect(positions[1].amountEur).toBeCloseTo(450)
    expect(positions[1].isSpecialUnit).toBe(true)
  })

  it('liest Mengen im deutschen Format mit Tausenderpunkt', () => {
    const positions = extractPositions(SAMPLE_INVOICE)
    expect(positions[1].quantityRaw).toBe('1.000,00')
    expect(positions[1].quantity).toBe(1000)
  })

  it('markiert Gutschriften/Rabatte zur manuellen Entscheidung', () => {
    const text = `Gutschrift Retoure
100,00 Stück
Sprayer K2
-250,00
Zolltarif-Nr.: 39235000`
    const positions = extractPositions(text)
    expect(positions[0].isCreditOrDiscountOrNegative).toBe(true)
    expect(positions[0].requiresManualDecision).toBe(true)
  })
})

describe('Adressen und Bestimmungsland', () => {
  it('findet den Lieferadress- und Auftragsadressblock', () => {
    expect(extractDeliveryAddressBlock(SAMPLE_INVOICE)).toContain('Handelskaai 12')
    expect(extractOrderAddressBlock(SAMPLE_INVOICE)).toContain('Rue de la Paix 5')
  })

  it('übersetzt das Länderkennzeichen der Lieferadresse ("A" → "AT")', () => {
    const delivery = parseAddress(extractDeliveryAddressBlock(SAMPLE_INVOICE), 'delivery')
    expect(delivery?.countryToken).toBe('A')
    expect(delivery?.countryCode).toBe('AT')
  })

  it('gibt der Lieferadresse Vorrang vor der Auftragsadresse', () => {
    const delivery = parseAddress(extractDeliveryAddressBlock(SAMPLE_INVOICE), 'delivery')
    const order = parseAddress(extractOrderAddressBlock(SAMPLE_INVOICE), 'order')
    const result = determineDestinationCountry(delivery, order, undefined)
    expect(result.code).toBe('AT')
    expect(result.source).toBe('delivery')
  })

  it('nutzt die Auftragsadresse, wenn keine Lieferadresse vorhanden ist', () => {
    const order = parseAddress('Beispiel Kunde AG\nRue de la Paix 5\nB-1000 Bruessel', 'order')
    const result = determineDestinationCountry(undefined, order, undefined)
    expect(result.code).toBe('BE')
    expect(result.source).toBe('order')
  })

  it('lässt das Land ungeklärt, wenn kein Kennzeichen erkennbar ist', () => {
    const order = parseAddress('Kunde AG\nSome Street 5\n12345 Somewhere', 'order')
    const result = determineDestinationCountry(undefined, order, undefined)
    expect(result.code).toBeNull()
    expect(result.source).toBe('unresolved')
  })

  it('verwendet eine dauerhaft gespeicherte Länder-Zuordnung', () => {
    saveCountryMapping('XY', 'IT')
    const order = parseAddress('Kunde AG\nVia Roma 1\nXY-00100 Roma', 'order')
    expect(order?.countryCode).toBeUndefined()
    const result = determineDestinationCountry(undefined, order, undefined)
    expect(result.code).toBe('IT')
    expect(result.source).toBe('gespeichertes-mapping')
  })
})
