import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTemplate, buildExportWorkbook, buildExportRow, buildExportFileName } from '../excelTemplate'
import type { Invoice, InvoicePosition } from '../../types'

const FIXTURE_PATH = join(__dirname, 'fixtures', 'Mustertabelle.xlsx')

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function makePosition(overrides: Partial<InvoicePosition> = {}): InvoicePosition {
  return {
    id: 'pos-1',
    lineNo: 1,
    productNameRaw: 'DPZ Hobby 1.0L',
    customsCode: '39235000',
    quantity: 500,
    amountEur: 1250,
    calculatedWeightKgRounded: 165,
    amountEurRounded: 1250,
    statisticalValueEurRounded: 1300,
    isSpecialUnit: false,
    isCreditOrDiscountOrNegative: false,
    manualCorrections: [],
    issues: [],
    status: 'ok',
    requiresManualDecision: false,
    ...overrides,
  }
}

function makeInvoice(positions: InvoicePosition[]): Invoice {
  return {
    id: 'invoice-1',
    fileName: 'test.pdf',
    rawText: '',
    ocrUsed: false,
    extractionFailed: false,
    referenceMonth: '08',
    referenceYear: '2026',
    destinationCountry: { code: 'BE', source: 'delivery', isManual: false },
    vatId: 'BE0123456789',
    netWeightTotal: 165,
    positions,
    manualCorrections: [],
    issues: [],
    status: 'ok',
  }
}

describe('excelTemplate', () => {
  it('lädt die Mustertabelle und erkennt das erste Arbeitsblatt', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    expect(template.worksheetName).toBe('Warenbewegung')
  })

  it('erhält Kopfzeile und Hinweiszeile und schreibt Datenzeilen ab Zeile 3', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    const invoice = makeInvoice([makePosition()])

    const outBuffer = await buildExportWorkbook(template, [invoice])

    const { loadTemplate: reload } = await import('../excelTemplate')
    const result = await reload(outBuffer)
    const ws = result.workbook.worksheets[0]

    expect(ws.getCell('A1').value).toBe('Richtung')
    expect(ws.getCell('B2').value).toBe('01, 02….')

    expect(ws.getCell('A3').value).toBe('V')
    expect(ws.getCell('B3').value).toBe('08')
    expect(ws.getCell('F3').value).toBe('BE')
    expect(ws.getCell('J3').value).toBe('39235000')
    expect(ws.getCell('L3').value).toBe(165)
    expect(ws.getCell('N3').value).toBe(1250)
    expect(ws.getCell('O3').value).toBe(1300)
    expect(ws.getCell('P3').value).toBe('BE0123456789')
  })

  it('lässt Spalte M nur bei Warennummer 39233010 gefüllt', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    const invoice = makeInvoice([
      makePosition({ id: 'p1', customsCode: '39235000', isSpecialUnit: false }),
      makePosition({ id: 'p2', customsCode: '39233010', isSpecialUnit: true, quantity: 42 }),
    ])

    const outBuffer = await buildExportWorkbook(template, [invoice])
    const result = await loadTemplate(outBuffer)
    const ws = result.workbook.worksheets[0]

    expect(ws.getCell('M3').value).toBeNull()
    expect(ws.getCell('M4').value).toBe(42)
  })

  it('schließt Gutschriften/negative Positionen vom Export aus', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    const invoice = makeInvoice([
      makePosition({ id: 'p1' }),
      makePosition({ id: 'p2', isCreditOrDiscountOrNegative: true }),
    ])

    const rows = invoice.positions.filter((p) => !p.isCreditOrDiscountOrNegative)
    expect(rows).toHaveLength(1)

    const outBuffer = await buildExportWorkbook(template, [invoice])
    const result = await loadTemplate(outBuffer)
    const ws = result.workbook.worksheets[0]
    expect(ws.getCell('A4').value).toBeNull() // keine zweite Datenzeile
  })

  it('erzeugt den Dateinamen im Format MM-JJJJ.xlsx', () => {
    expect(buildExportFileName('08', '2026')).toBe('08-2026.xlsx')
  })

  it('buildExportRow setzt feste Werte gemäß Mapping', () => {
    const invoice = makeInvoice([])
    const row = buildExportRow(invoice, makePosition())
    expect(row.richtung).toBe('V')
    expect(row.artDesGeschaeftes).toBe('11')
    expect(row.verkehrszweig).toBe('3')
    expect(row.ursprungsBundesland).toBe('09')
    expect(row.ursprungsland).toBe('DE')
    expect(row.versendungsMitgliedstaat).toBe('')
    expect(row.bestimmungsBundesland).toBe('')
    expect(row.warenbezeichnung).toBe('')
  })
})
