import { describe, it, expect } from 'vitest'
import { compareMeldungWithInvoices } from '../meldungValidation'

describe('compareMeldungWithInvoices', () => {
  it('meldet keine Abweichung, wenn jede Meldungs-Nummer durch genau eine Rechnung gedeckt ist', () => {
    const invoices = [
      { id: 'a', invoiceNumber: '168049' },
      { id: 'b', invoiceNumber: '167924' },
    ]
    const result = compareMeldungWithInvoices(['168049', '167924'], invoices)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([])
  })

  it('meldet eine Meldungs-Nummer als fehlend, wenn keine Rechnung dazu passt', () => {
    const invoices = [{ id: 'a', invoiceNumber: '168049' }]
    const result = compareMeldungWithInvoices(['168049', '167924'], invoices)
    expect(result.missing).toEqual(['167924'])
    expect(result.extra).toEqual([])
  })

  it('meldet eine Rechnung als zusätzlich, wenn ihre Nummer nicht auf der Meldung steht', () => {
    const invoices = [
      { id: 'a', invoiceNumber: '168049' },
      { id: 'b', invoiceNumber: '999999' },
    ]
    const result = compareMeldungWithInvoices(['168049'], invoices)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([{ invoiceId: 'b', invoiceNumber: '999999' }])
  })

  it('behandelt eine doppelt vorkommende Rechnungsnummer nicht als fehlend', () => {
    const invoices = [
      { id: 'a', invoiceNumber: '167924' },
      { id: 'b', invoiceNumber: '167924' },
    ]
    const result = compareMeldungWithInvoices(['167924'], invoices)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([])
  })

  it('ignoriert Rechnungen ohne Rechnungsnummer', () => {
    const invoices = [{ id: 'a', invoiceNumber: undefined }]
    const result = compareMeldungWithInvoices(['168049'], invoices)
    expect(result.missing).toEqual(['168049'])
    expect(result.extra).toEqual([])
  })
})
