// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  deriveReferencePeriod,
  normalizeInvoiceDateInput,
  resolveAmbiguousDateFormat,
  buildManualInvoice,
  buildManualPosition,
  isNonMerchandiseArticleNumber,
} from '../aiInvoiceBuilder'

describe('deriveReferencePeriod', () => {
  it('leitet Monat und Jahr aus dem Rechnungsdatum ab', () => {
    expect(deriveReferencePeriod('05.08.2026')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod('5.8.26')).toEqual({ month: '08', year: '2026' })
    expect(deriveReferencePeriod(undefined)).toBeUndefined()
  })

  it('gibt undefined zurück bei unklarem Format', () => {
    expect(deriveReferencePeriod('nicht ein datum')).toBeUndefined()
  })
})

describe('normalizeInvoiceDateInput', () => {
  it('wandelt eine 8-stellige Ziffernfolge in TT.MM.JJJJ um', () => {
    expect(normalizeInvoiceDateInput('01072026')).toBe('01.07.2026')
  })

  it('wandelt eine 6-stellige Ziffernfolge (2-stelliges Jahr) in TT.MM.JJJJ um', () => {
    expect(normalizeInvoiceDateInput('010726')).toBe('01.07.2026')
  })

  it('lässt bereits mit Punkten versehene Eingaben unverändert', () => {
    expect(normalizeInvoiceDateInput('01.07.2026')).toBe('01.07.2026')
  })

  it('lässt unklare Eingaben (weder 6 noch 8 Ziffern) unverändert', () => {
    expect(normalizeInvoiceDateInput('0107202')).toBe('0107202')
    expect(normalizeInvoiceDateInput('')).toBe('')
  })
})

describe('resolveAmbiguousDateFormat', () => {
  it('wählt TT/MM/JJJJ, wenn nur diese Lesart zum gewählten Bezugsmonat passt', () => {
    // 13 kann kein Monat sein -> muss TT/MM/JJJJ sein (13.07.2026).
    expect(resolveAmbiguousDateFormat('13/07/2026', '07')).toBe('13.07.2026')
  })

  it('wählt MM/TT/JJJJ, wenn nur diese Lesart zum gewählten Bezugsmonat passt', () => {
    // "07/13/2026": als TT/MM ergäbe das Monat 13 (ungültig) -> MM/TT, Bezugsmonat 07 bestätigt das.
    expect(resolveAmbiguousDateFormat('07/13/2026', '07')).toBe('13.07.2026')
  })

  it('bevorzugt TT/MM/JJJJ (europäische Konvention), wenn beide Lesarten gültig sind und der Bezugsmonat nicht hilft', () => {
    expect(resolveAmbiguousDateFormat('01/07/2026')).toBe('01.07.2026')
  })

  it('weicht auf MM/TT/JJJJ aus, wenn TT/MM einen ungültigen Monat ergäbe (kein Bezugsmonat vorhanden)', () => {
    // "07/25/2026": als TT/MM ergäbe das Monat 25 (ungültig) -> MM/TT/JJJJ (25.07.2026).
    expect(resolveAmbiguousDateFormat('07/25/2026')).toBe('25.07.2026')
  })

  it('wandelt ein 2-stelliges Jahr in ein 4-stelliges um', () => {
    expect(resolveAmbiguousDateFormat('01/07/26')).toBe('01.07.2026')
  })

  it('lässt bereits punktgetrennte Daten unverändert', () => {
    expect(resolveAmbiguousDateFormat('13.07.2026', '07')).toBe('13.07.2026')
  })

  it('lässt undefined/leer unverändert', () => {
    expect(resolveAmbiguousDateFormat(undefined, '07')).toBeUndefined()
  })
})

describe('isNonMerchandiseArticleNumber', () => {
  it('erkennt jede Artikelnummer mit Präfix "09"', () => {
    expect(isNonMerchandiseArticleNumber('090025')).toBe(true)
    expect(isNonMerchandiseArticleNumber('090040')).toBe(true)
    expect(isNonMerchandiseArticleNumber('002000')).toBe(false)
    expect(isNonMerchandiseArticleNumber(undefined)).toBe(false)
  })
})

describe('manuelle Erfassung', () => {
  it('buildManualInvoice erzeugt eine leere Rechnung mit gesetzter Richtung', () => {
    const invoice = buildManualInvoice('manual-1', 'E')
    expect(invoice.richtung).toBe('E')
    expect(invoice.isManualEntry).toBe(true)
    expect(invoice.positions).toEqual([])
  })

  it('setzt bei manuell erfassten Rechnungen die jeweils festen Spalten E/G/H/I', () => {
    const ausgang = buildManualInvoice('manual-v', 'V')
    expect(ausgang.ursprungsBundesland).toBe('09')
    expect(ausgang.ursprungsland).toBe('DE')

    const eingang = buildManualInvoice('manual-e', 'E')
    expect(eingang.versendungsMitgliedstaat).toBeUndefined()
    expect(eingang.bestimmungsBundesland).toBe('09')
    expect(eingang.ursprungsBundesland).toBe('')
  })

  it('buildManualPosition erzeugt eine leere, editierbare Position', () => {
    const position = buildManualPosition()
    expect(position.isManualEntry).toBe(true)
    expect(position.productNameRaw).toBe('')
    expect(position.isTransportCost).toBe(false)
    expect(position.isMtzSurcharge).toBe(false)
  })
})
