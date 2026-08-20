// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { compareWithAi, aiUncertaintyNotes } from '../aiCompare'
import { applyAiValue, canApplyAiValue } from '../aiApply'
import type { AiInvoiceFields, Invoice, InvoicePosition } from '../../types'

function position(overrides: Partial<InvoicePosition> = {}): InvoicePosition {
  return {
    id: 'p1',
    lineNo: 1,
    positionNumber: '10',
    productNameRaw: 'Sprayer K2 rot mit Kappe',
    customsCode: '39235000',
    quantity: 1000,
    amountEur: 125,
    isSpecialUnit: false,
    isCreditOrDiscountOrNegative: false,
    manualCorrections: [],
    issues: [],
    status: 'ok',
    requiresManualDecision: false,
    ...overrides,
  }
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    fileName: 'rechnung.pdf',
    rawText: '',
    ocrUsed: false,
    extractionFailed: false,
    hasFontInfo: true,
    language: 'de',
    invoiceNumber: '4711-2026',
    invoiceDateRaw: '05.08.2026',
    referenceMonth: '08',
    referenceYear: '2026',
    vatId: 'BE0123456789',
    destinationCountry: { code: 'AT', source: 'delivery', isManual: false, token: 'A' },
    netWeightTotal: 50,
    positions: [position()],
    manualCorrections: [],
    issues: [],
    status: 'ok',
    ...overrides,
  }
}

const MATCHING_AI: AiInvoiceFields = {
  invoiceNumber: '4711-2026',
  invoiceDate: '05.08.2026',
  vatId: 'BE 0123456789',
  destinationCountryCode: 'AT',
  netWeightTotalKg: 50,
  positions: [
    {
      positionNumber: '10',
      productDescription: 'Sprayer K2 rot mit Kappe',
      customsCode: '39235000',
      quantity: 1000,
      amountEur: 125,
    },
  ],
}

describe('compareWithAi', () => {
  it('meldet keine Abweichung bei übereinstimmenden Werten', () => {
    expect(compareWithAi(invoice(), MATCHING_AI)).toHaveLength(0)
  })

  it('ignoriert Leerzeichen in der USt-IdNr.', () => {
    const result = compareWithAi(invoice(), { ...MATCHING_AI, vatId: 'BE 0123 456 789' })
    expect(result.some((d) => d.field === 'vatId')).toBe(false)
  })

  it('meldet ein abweichendes Rechnungsdatum', () => {
    const result = compareWithAi(invoice(), { ...MATCHING_AI, invoiceDate: '15.07.2026' })
    const found = result.find((d) => d.field === 'invoiceDateRaw')
    expect(found?.ownValue).toBe('05.08.2026')
    expect(found?.aiValue).toBe('15.07.2026')
  })

  it('meldet ein abweichendes Bestimmungsland', () => {
    const result = compareWithAi(invoice(), { ...MATCHING_AI, destinationCountryCode: 'be' })
    expect(result.find((d) => d.field === 'destinationCountry')?.aiValue).toBe('BE')
  })

  it('meldet eine abweichende Menge', () => {
    const result = compareWithAi(invoice(), {
      ...MATCHING_AI,
      positions: [{ ...MATCHING_AI.positions![0], quantity: 100 }],
    })
    const found = result.find((d) => d.field.endsWith(':quantity'))
    expect(found?.ownValue).toBe('1000')
    expect(found?.aiValue).toBe('100')
  })

  it('toleriert Rundungsunterschiede bei Beträgen', () => {
    const result = compareWithAi(invoice(), {
      ...MATCHING_AI,
      positions: [{ ...MATCHING_AI.positions![0], amountEur: 125.001 }],
    })
    expect(result.some((d) => d.field.endsWith(':amountEur'))).toBe(false)
  })

  it('ignoriert reine Schreibweisen-Unterschiede der Produktbezeichnung', () => {
    const result = compareWithAi(
      invoice({ positions: [position({ productNameRaw: 'DPZ Hobby 1.0L natur' })] }),
      {
        ...MATCHING_AI,
        positions: [{ ...MATCHING_AI.positions![0], productDescription: 'DPZ Hobby 1,0 L natur' }],
      },
    )
    expect(result.some((d) => d.field.endsWith(':productNameRaw'))).toBe(false)
  })

  it('meldet eine abweichende Anzahl von Positionen', () => {
    const result = compareWithAi(invoice(), { ...MATCHING_AI, positions: [] })
    expect(result.some((d) => d.field === 'positionCount')).toBe(true)
  })

  it('meldet eine von der KI erkannte Gutschrift', () => {
    const result = compareWithAi(invoice(), {
      ...MATCHING_AI,
      positions: [{ ...MATCHING_AI.positions![0], isCreditOrDiscount: true }],
    })
    expect(result.some((d) => d.field.endsWith(':credit'))).toBe(true)
  })

  it('meldet ein abweichendes Gewicht aus der Produktbeschreibung', () => {
    const withDescriptionWeight = invoice({
      positions: [
        position({
          productNameRaw: 'Zyl.Flasche 250 ml Gew.:20 g',
          productMatch: {
            matchType: 'beschreibung',
            entry: { name: 'Gewicht aus Produktbeschreibung', unitWeightGrams: 20 },
            suggestions: [],
          },
        }),
      ],
    })
    const result = compareWithAi(withDescriptionWeight, {
      ...MATCHING_AI,
      positions: [{ ...MATCHING_AI.positions![0], weightPerPieceGrams: 25 }],
    })
    expect(result.some((d) => d.field.endsWith(':descriptionWeight'))).toBe(true)
  })

  it('gibt die von der KI gemeldeten unsicheren Felder zurück', () => {
    expect(aiUncertaintyNotes({ positions: [], uncertainFields: ['Menge Position 20', ''] })).toEqual([
      'Menge Position 20',
    ])
  })
})

describe('applyAiValue', () => {
  it('übernimmt das Rechnungsdatum und leitet den Bezugsmonat neu ab', () => {
    const result = compareWithAi(invoice(), { ...MATCHING_AI, invoiceDate: '15.09.2026' })
    const updated = applyAiValue(invoice(), result[0])
    expect(updated.invoiceDateRaw).toBe('15.09.2026')
    expect(updated.referenceMonth).toBe('09')
    expect(updated.referenceYear).toBe('2026')
    expect(updated.manualCorrections).toHaveLength(1)
  })

  it('übernimmt eine Menge in die richtige Position', () => {
    const base = invoice()
    const result = compareWithAi(base, {
      ...MATCHING_AI,
      positions: [{ ...MATCHING_AI.positions![0], quantity: 252 }],
    })
    const updated = applyAiValue(base, result[0])
    expect(updated.positions[0].quantity).toBe(252)
    expect(updated.positions[0].manualCorrections).toHaveLength(1)
  })

  it('setzt bei Übernahme einer Warennummer die Spalte-M-Kennzeichnung neu', () => {
    const base = invoice()
    const result = compareWithAi(base, {
      ...MATCHING_AI,
      positions: [{ ...MATCHING_AI.positions![0], customsCode: '39233010' }],
    })
    const updated = applyAiValue(base, result[0])
    expect(updated.positions[0].customsCode).toBe('39233010')
    expect(updated.positions[0].isSpecialUnit).toBe(true)
  })

  it('markiert ein übernommenes Bestimmungsland als manuell bestätigt', () => {
    const base = invoice()
    const result = compareWithAi(base, { ...MATCHING_AI, destinationCountryCode: 'BE' })
    const updated = applyAiValue(base, result[0])
    expect(updated.destinationCountry?.code).toBe('BE')
    expect(updated.destinationCountry?.isManual).toBe(true)
    expect(updated.destinationCountry?.needsConfirmation).toBe(false)
  })

  it('setzt bei Übernahme einer Produktbezeichnung die Zuordnung zurück', () => {
    const base = invoice()
    const result = compareWithAi(base, {
      ...MATCHING_AI,
      positions: [{ ...MATCHING_AI.positions![0], productDescription: 'Sprayer K3 blau' }],
    })
    const updated = applyAiValue(base, result[0])
    expect(updated.positions[0].productNameRaw).toBe('Sprayer K3 blau')
    expect(updated.positions[0].productMatch).toBeUndefined()
  })
})

describe('canApplyAiValue', () => {
  it('erlaubt die Übernahme bei direkt setzbaren Feldern', () => {
    expect(canApplyAiValue('invoiceDateRaw')).toBe(true)
    expect(canApplyAiValue('destinationCountry')).toBe(true)
    expect(canApplyAiValue('position:p1:quantity')).toBe(true)
  })

  it('erlaubt keine Übernahme bei rein informativen Abweichungen', () => {
    expect(canApplyAiValue('positionCount')).toBe(false)
    expect(canApplyAiValue('position:p1:descriptionWeight')).toBe(false)
  })
})
