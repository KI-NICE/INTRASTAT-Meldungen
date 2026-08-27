// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { recalculateInvoice } from '../processing'
import type { Invoice, InvoicePosition } from '../../types'

function makePosition(overrides: Partial<InvoicePosition> = {}): InvoicePosition {
  return {
    id: overrides.id ?? `pos-${Math.random().toString(36).slice(2, 8)}`,
    lineNo: 1,
    positionNumber: undefined,
    productNameRaw: '',
    isSpecialUnit: false,
    isTransportCost: false,
    isMtzSurcharge: false,
    isCreditOrDiscountOrNegative: false,
    manualCorrections: [],
    issues: [],
    status: 'ok',
    requiresManualDecision: false,
    ...overrides,
  }
}

function makeInvoice(positions: InvoicePosition[], overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice-1',
    fileName: 'test.xlsx',
    richtung: 'V',
    language: 'de',
    positions,
    manualCorrections: [],
    issues: [],
    status: 'pending',
    ...overrides,
  }
}

describe('recalculateInvoice löst mehrdeutige Schrägstrich-Daten anhand des Bezugsmonats auf', () => {
  it('normalisiert ein mit Schrägstrichen geschriebenes Datum auf TT.MM.JJJJ und leitet den Bezugsmonat korrekt ab', () => {
    const invoice = makeInvoice([], { invoiceDateRaw: '07/13/2026' })
    const result = recalculateInvoice(invoice, { V: {}, E: {} }, '07', '2026')
    expect(result.invoiceDateRaw).toBe('13.07.2026')
    expect(result.referenceMonth).toBe('07')
    expect(result.referenceYear).toBe('2026')
  })
})

describe('Frachtkosten: keine doppelte Berechnung', () => {
  it('legt Frachtkosten nur einmal um, wenn eine Frachtkosten-Position UND ein Kopf-Betrag vorliegen', () => {
    // Die Rechnung weist dieselben Frachtkosten sowohl als Position
    // (Artikelnummer 090025) als auch im Kopf aus – ein reales Muster, das
    // sonst zur doppelten Umlage führte (einmal aus der Position, einmal
    // zusätzlich aus dem Kopf-Betrag addiert).
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'Sprayer K2', customsCode: '39235000', quantity: 100, amountEur: 100 }),
      makePosition({ id: 'p20', positionNumber: '20', productNameRaw: 'Frachtkosten', articleNumberRaw: '090025', isTransportCost: true, amountEur: 10 }),
    ]
    const invoice = makeInvoice(positions, { freightCost: 10 })
    const result = recalculateInvoice(invoice, { V: {}, E: {} }, '08', '2026')

    const normalPosition = result.positions.find((p) => p.positionNumber === '10')
    // 100 + (100/100)*10 = 110 – NICHT 120 (das wäre die doppelte Umlage).
    expect(normalPosition?.amountEurRounded).toBe(110)

    const transportPosition = result.positions.find((p) => p.positionNumber === '20')
    expect(transportPosition?.amountEurRounded).toBeUndefined()
  })

  it('verwendet den Kopf-Betrag, wenn keine Frachtkosten-Position vorhanden ist', () => {
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'Sprayer K2', customsCode: '39235000', quantity: 100, amountEur: 100 }),
    ]
    const invoice = makeInvoice(positions, { freightCost: 10 })
    const result = recalculateInvoice(invoice, { V: {}, E: {} }, '08', '2026')

    expect(result.positions[0].amountEurRounded).toBe(110)
  })

  it('summiert mehrere Frachtkosten-Positionen, addiert aber nicht zusätzlich den Kopf-Betrag', () => {
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'Sprayer K2', customsCode: '39235000', quantity: 100, amountEur: 100 }),
      makePosition({ id: 'p20', positionNumber: '20', productNameRaw: 'Fracht A', articleNumberRaw: '090025', isTransportCost: true, amountEur: 6 }),
      makePosition({ id: 'p30', positionNumber: '30', productNameRaw: 'Fracht B', articleNumberRaw: '090025', isTransportCost: true, amountEur: 4 }),
    ]
    const invoice = makeInvoice(positions, { freightCost: 15 })
    const result = recalculateInvoice(invoice, { V: {}, E: {} }, '08', '2026')

    // Summe der Frachtkosten-Positionen: 10 EUR -> 100 + 10 = 110, nicht 125.
    expect(result.positions[0].amountEurRounded).toBe(110)
  })
})

describe('Spalte O: 4-%-Zuschlag ausschließlich auf reinen Warenwert ohne Frachtkosten', () => {
  it('berechnet den statistischen Wert ohne die Frachtkosten mit einzubeziehen', () => {
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'Sprayer K2', customsCode: '39235000', quantity: 100, amountEur: 100 }),
    ]
    const invoice = makeInvoice(positions, { freightCost: 100 })
    const result = recalculateInvoice(invoice, { V: {}, E: {} }, '08', '2026')

    // Spalte N enthält die Frachtkosten (100 + 100 = 200), Spalte O NICHT:
    // 100 * 1.04 = 104 – nicht 208 (was bei Einbeziehung der Fracht entstünde).
    expect(result.positions[0].amountEurRounded).toBe(200)
    expect(result.positions[0].statisticalValueEurRounded).toBe(104)
  })

  it('verteilt den 4-%-Zuschlag wertanteilig auf Basis der reinen Positionswerte', () => {
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'A', customsCode: '39235000', quantity: 1, amountEur: 750 }),
      makePosition({ id: 'p20', positionNumber: '20', productNameRaw: 'B', customsCode: '39235000', quantity: 1, amountEur: 250 }),
    ]
    const invoice = makeInvoice(positions, { freightCost: 1000 })
    const result = recalculateInvoice(invoice, { V: {}, E: {} }, '08', '2026')

    // 4 % von (750+250)=1000 -> 40 EUR, wertanteilig 75/25 verteilt: 30 / 10.
    expect(result.positions[0].statisticalValueEurRounded).toBe(780)
    expect(result.positions[1].statisticalValueEurRounded).toBe(260)
  })
})

describe('Materialteuerungszuschlag: Zurechnung wirkt sich auf Spalte N und O aus', () => {
  it('rechnet den Zuschlag der Artikelposition zu, bevor N und O berechnet werden', () => {
    // Die Zurechnung (Betrag + Artikelposition) ist bereits vor
    // recalculateInvoice erfolgt (siehe excelImport.attributeMtzToPreviousPosition).
    const positions = [
      makePosition({
        id: 'p10',
        positionNumber: '10',
        productNameRaw: 'Sprayer K2',
        customsCode: '39235000',
        quantity: 1000,
        amountEur: 110, // 100 Warenwert + 10 zugerechneter MTZ
        articleNumberRaw: '002000',
        mtzSurchargeEurRaw: 10,
      }),
      makePosition({
        id: 'p20',
        positionNumber: '20',
        productNameRaw: 'MTZ',
        articleNumberRaw: '090040',
        isMtzSurcharge: true,
        amountEur: 10,
      }),
    ]
    const invoice = makeInvoice(positions)
    const result = recalculateInvoice(invoice, { V: {}, E: {} }, '08', '2026')

    const article = result.positions.find((p) => p.positionNumber === '10')
    const mtz = result.positions.find((p) => p.positionNumber === '20')

    // Positionswert 100 + 10 MTZ = 110; keine weiteren Frachtkosten -> Spalte N = 110.
    expect(article?.amountEurRounded).toBe(110)
    // Spalte O: 110 * 1.04 = 114.4 -> aufgerundet 115.
    expect(article?.statisticalValueEurRounded).toBe(115)
    expect(mtz?.amountEurRounded).toBeUndefined()
  })
})

describe('Gewichtsliste ändern/zurücksetzen wirkt sich sofort auf bereits zugeordnete Artikel aus', () => {
  it('rechnet nach einem Wechsel der Gewichtsliste sofort mit dem neuen (bzw. zurückgesetzten) Wert, nicht mehr mit einer alten manuellen Korrektur', () => {
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'Sprayer K2', customsCode: '39235000', quantity: 1000, amountEur: 100, articleNumberRaw: '002000' }),
    ]
    const invoice = makeInvoice(positions)

    // Erste Berechnung mit Werksstand (50 g).
    const first = recalculateInvoice(invoice, { V: { '002000': 50 }, E: {} }, '08', '2026')
    expect(first.positions[0].productMatch?.entry?.unitWeightGrams).toBe(50)

    // Manuelle Korrektur auf 62 g landet direkt in der Gewichtsliste (siehe
    // App.handleConfirmProductMapping) und wird sofort übernommen.
    const corrected = {
      ...first,
      positions: first.positions.map((p) => ({
        ...p,
        productMatch: { matchType: 'manual' as const, entry: { name: '002000', unitWeightGrams: 62 }, suggestions: [] },
      })),
    }
    const afterCorrection = recalculateInvoice(corrected, { V: { '002000': 62 }, E: {} }, '08', '2026')
    expect(afterCorrection.positions[0].productMatch?.entry?.unitWeightGrams).toBe(62)
    expect(afterCorrection.positions[0].calculatedWeightKgRounded).toBe(62)

    // Gewichtsliste wird auf den Werksstand zurückgesetzt (50 g). Trotz des
    // zuvor als "manual" markierten productMatch MUSS jetzt wieder frisch
    // gegen die (zurückgesetzte) Liste abgeglichen werden.
    const afterReset = recalculateInvoice(afterCorrection, { V: { '002000': 50 }, E: {} }, '08', '2026')
    expect(afterReset.positions[0].productMatch?.entry?.unitWeightGrams).toBe(50)
    expect(afterReset.positions[0].productMatch?.matchType).toBe('exact')
    expect(afterReset.positions[0].calculatedWeightKgRounded).toBe(50)
  })

  it('behält eine manuelle Korrektur OHNE Artikelnummer dauerhaft an dieser Position (keine Gewichtsliste zum Nachschlagen vorhanden)', () => {
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'Sprayer ohne Artikelnummer', customsCode: '39235000', quantity: 10, amountEur: 100 }),
    ]
    const invoice = makeInvoice(positions)
    const corrected = {
      ...invoice,
      positions: invoice.positions.map((p) => ({
        ...p,
        productMatch: { matchType: 'manual' as const, entry: { name: 'manuell', unitWeightGrams: 33 }, suggestions: [] },
      })),
    }
    const result = recalculateInvoice(corrected, { V: {}, E: {} }, '08', '2026')
    expect(result.positions[0].productMatch?.matchType).toBe('manual')
    expect(result.positions[0].productMatch?.entry?.unitWeightGrams).toBe(33)
  })
})

describe('Status bei Gewichtsdifferenzen und manuell bestätigter Toleranz', () => {
  function buildValidInvoice(overrides: Partial<Invoice> = {}): Invoice {
    const positions = [
      makePosition({ id: 'p10', positionNumber: '10', productNameRaw: 'Sprayer K2', customsCode: '39235000', quantity: 1000, amountEur: 100, articleNumberRaw: '002000' }),
    ]
    return makeInvoice(positions, {
      invoiceDateRaw: '05.08.2026',
      referenceMonth: '08',
      referenceYear: '2026',
      vatId: 'BE0123456789',
      destinationCountry: { code: 'BE', source: 'excel', isManual: false },
      netWeightTotal: 100,
      ...overrides,
    })
  }

  it('erzeugt bei einer Differenz von 1-2 kg keine Meldung und lässt eine sonst fehlerfreie Rechnung "ok" (das Badge "Toleranz < 2 kg" wird clientseitig in ReviewTable.tsx ergänzt)', () => {
    // Berechnetes Gewicht: 1000 Stück * 100 g / 1000 = 100 kg -> Differenz -1 kg.
    const invoice = buildValidInvoice({ netWeightTotal: 101 })
    const result = recalculateInvoice(invoice, { V: { '002000': 100 }, E: {} }, '08', '2026')
    expect(result.status).toBe('ok')
    expect(result.issues.some((i) => i.field === 'weightSum')).toBe(false)
  })

  it('sperrt Differenzen über 2 kg ohne manuelle Bestätigung als Fehler', () => {
    const invoice = buildValidInvoice({ netWeightTotal: 105 })
    const result = recalculateInvoice(invoice, { V: { '002000': 100 }, E: {} }, '08', '2026')
    expect(result.status).toBe('error')
  })

  it('markiert eine ansonsten fehlerfreie Rechnung nach manueller Toleranz-Bestätigung grün (ok)', () => {
    const invoice = buildValidInvoice({ netWeightTotal: 105, weightToleranceAccepted: true })
    const result = recalculateInvoice(invoice, { V: { '002000': 100 }, E: {} }, '08', '2026')
    expect(result.status).toBe('ok')
    expect(result.issues.some((i) => i.field === 'weightSum')).toBe(true)
  })
})
