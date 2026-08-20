import { describe, it, expect } from 'vitest'
import {
  extractInvoiceNumber,
  extractReferenceMonth,
  extractVatId,
  extractNetWeightTotal,
  extractGoodsValueTotal,
  extractFreightCost,
  extractPositions,
  parseAddress,
  determineDestinationCountry,
} from '../invoiceParser'

const SAMPLE_INVOICE = `
Musterfirma GmbH
Beispielweg 3
1234 Beispielstadt

Empfänger Kunde AG
Rue de la Paix 5
1000 Brüssel
Belgien

Lieferadresse:
Kunde Filiale
Handelskaai 12
1000 Brüssel
Belgien

Rechnungsnummer: 2026-08-0001
Rechnungsdatum: 05.08.2026
Vom: 01.08.2026 Bis: 31.08.2026
Ihre USt-IdNr.: BE 0123456789

Position 1
Produktbezeichnung: DPZ Hobby 1.0L
Menge: 500
Zolltarif-Nr.: 39235000
Betrag: 1.250,00 EUR

Position 2
Produktbezeichnung: Sicherheitsverschluss
Menge: 1000
Zolltarif-Nr..: 39233010
Betrag: 450,00 EUR

Netto-Gesamtgewicht: 165 kg
Warenwert gesamt: 1.700,00 EUR
Frachtkosten: 50,00 EUR
`

describe('invoiceParser – Kopf-/Metafelder', () => {
  it('extrahiert die Rechnungsnummer', () => {
    expect(extractInvoiceNumber(SAMPLE_INVOICE)).toBe('2026-08-0001')
  })

  it('extrahiert Monat und Jahr aus dem Feld "Vom:"', () => {
    expect(extractReferenceMonth(SAMPLE_INVOICE)).toEqual({ month: '08', year: '2026', raw: '01.08.2026' })
  })

  it('bereinigt die USt-IdNr. von Leerzeichen', () => {
    expect(extractVatId(SAMPLE_INVOICE)).toBe('BE0123456789')
  })

  it('liest Netto-Gesamtgewicht, Warenwert und Frachtkosten', () => {
    expect(extractNetWeightTotal(SAMPLE_INVOICE)).toBeCloseTo(165)
    expect(extractGoodsValueTotal(SAMPLE_INVOICE)).toBeCloseTo(1700)
    expect(extractFreightCost(SAMPLE_INVOICE)).toBeCloseTo(50)
  })
})

describe('invoiceParser – Positionen', () => {
  it('erkennt beide Positionen mit Zolltarif-Nr., Menge und Betrag', () => {
    const positions = extractPositions(SAMPLE_INVOICE)
    expect(positions).toHaveLength(2)
    expect(positions[0].customsCode).toBe('39235000')
    expect(positions[0].quantity).toBe(500)
    expect(positions[0].amountEur).toBeCloseTo(1250)
    expect(positions[1].customsCode).toBe('39233010')
    expect(positions[1].isSpecialUnit).toBe(true)
  })
})

describe('invoiceParser – Adressen/Land', () => {
  it('erkennt das Land aus der Lieferadresse mit höherer Priorität als aus der Empfängeradresse', () => {
    const delivery = parseAddress('Kunde Filiale\nHandelskaai 12\n1000 Brüssel\nBelgien')
    const recipient = parseAddress('Empfänger Kunde AG\nRue de la Paix 5\n1000 Brüssel\nBelgien')
    const result = determineDestinationCountry(delivery, recipient)
    expect(result.code).toBe('BE')
    expect(result.source).toBe('delivery')
  })

  it('fällt auf die Empfängeradresse zurück, wenn keine Lieferadresse vorhanden ist', () => {
    const recipient = parseAddress('Empfänger Kunde AG\nRue de la Paix 5\n1000 Brüssel\nBelgien')
    const result = determineDestinationCountry(undefined, recipient)
    expect(result.code).toBe('BE')
    expect(result.source).toBe('recipient')
  })

  it('liefert unresolved, wenn kein Land erkennbar ist', () => {
    const result = determineDestinationCountry(undefined, undefined)
    expect(result.code).toBeNull()
    expect(result.source).toBe('unresolved')
  })
})
