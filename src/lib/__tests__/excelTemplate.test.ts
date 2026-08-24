import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTemplate, buildExportWorkbook, buildExportRow, buildExportFileName, getExportablePositions } from '../excelTemplate'
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

function makeInvoice(positions: InvoicePosition[]): Invoice {
  return {
    id: 'invoice-1',
    fileName: 'test.pdf',
    richtung: 'V',
    language: 'de',
    referenceMonth: '08',
    referenceYear: '2026',
    destinationCountry: { code: 'BE', source: 'ai', isManual: false },
    vatId: 'BE0123456789',
    versendungsMitgliedstaat: '',
    bestimmungsBundesland: '',
    ursprungsBundesland: '09',
    ursprungsland: 'DE',
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

    // Sortiert nach Warennummer: "39233010" steht vor "39235000".
    expect(ws.getCell('J3').value).toBe('39233010')
    expect(ws.getCell('M3').value).toBe(42)
    expect(ws.getCell('J4').value).toBe('39235000')
    expect(ws.getCell('M4').value).toBeNull()
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

  it('schließt Frachtkosten-Positionen (Artikelnummer 090025) vom Export aus', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    const invoice = makeInvoice([
      makePosition({ id: 'p1' }),
      makePosition({ id: 'p2', isTransportCost: true, articleNumberRaw: '090025', productNameRaw: 'Frachtkosten' }),
    ])

    const outBuffer = await buildExportWorkbook(template, [invoice])
    const result = await loadTemplate(outBuffer)
    const ws = result.workbook.worksheets[0]
    expect(ws.getCell('A4').value).toBeNull() // keine zweite Datenzeile
  })

  it('sortiert die exportierten Zeilen je Rechnung nach Warennummer', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    const invoice = makeInvoice([
      makePosition({ id: 'p1', customsCode: '39235000' }),
      makePosition({ id: 'p2', customsCode: '10011900' }),
      makePosition({ id: 'p3', customsCode: '22042110' }),
    ])

    const outBuffer = await buildExportWorkbook(template, [invoice])
    const result = await loadTemplate(outBuffer)
    const ws = result.workbook.worksheets[0]

    expect(ws.getCell('J3').value).toBe('10011900')
    expect(ws.getCell('J4').value).toBe('22042110')
    expect(ws.getCell('J5').value).toBe('39235000')
  })

  it('getExportablePositions sortiert nach Warennummer, stellt fehlende Warennummern ans Ende', () => {
    const invoice = makeInvoice([
      makePosition({ id: 'p1', customsCode: '39235000' }),
      makePosition({ id: 'p2', customsCode: undefined }),
      makePosition({ id: 'p3', customsCode: '10011900' }),
      makePosition({ id: 'p4', isTransportCost: true, articleNumberRaw: '090025' }),
      makePosition({ id: 'p5', isCreditOrDiscountOrNegative: true }),
    ])

    const result = getExportablePositions(invoice)
    expect(result.map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
  })

  it('sortiert innerhalb jeder Rechnung separat, ohne Rechnungen zu vermischen', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    const invoiceA = { ...makeInvoice([makePosition({ id: 'a1', customsCode: '90000000' })]), id: 'inv-a' }
    const invoiceB = { ...makeInvoice([makePosition({ id: 'b1', customsCode: '10000000' })]), id: 'inv-b' }

    const outBuffer = await buildExportWorkbook(template, [invoiceA, invoiceB])
    const result = await loadTemplate(outBuffer)
    const ws = result.workbook.worksheets[0]

    // Reihenfolge der Rechnungen bleibt erhalten (Sortierung gilt pro Rechnung).
    expect(ws.getCell('J3').value).toBe('90000000')
    expect(ws.getCell('J4').value).toBe('10000000')
  })

  it('fasst im Export Positionen einer Rechnung mit gleicher Warennummer zu einer Zeile zusammen', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const template = await loadTemplate(toArrayBuffer(buffer))
    const invoice = makeInvoice([
      makePosition({
        id: 'p1',
        customsCode: '39235000',
        calculatedWeightKgRounded: 100,
        amountEurRounded: 500,
        statisticalValueEurRounded: 520,
      }),
      makePosition({
        id: 'p2',
        customsCode: '39235000',
        calculatedWeightKgRounded: 50,
        amountEurRounded: 250,
        statisticalValueEurRounded: 260,
      }),
      makePosition({
        id: 'p3',
        customsCode: '10011900',
        calculatedWeightKgRounded: 10,
        amountEurRounded: 30,
        statisticalValueEurRounded: 31,
      }),
    ])

    const outBuffer = await buildExportWorkbook(template, [invoice])
    const result = await loadTemplate(outBuffer)
    const ws = result.workbook.worksheets[0]

    // Nur zwei Zeilen (statt drei): "39235000" wurde zusammengefasst.
    expect(ws.getCell('J3').value).toBe('10011900')
    expect(ws.getCell('J4').value).toBe('39235000')
    expect(ws.getCell('L4').value).toBe(150)
    expect(ws.getCell('N4').value).toBe(750)
    expect(ws.getCell('O4').value).toBe(780)
    expect(ws.getCell('A5').value).toBeNull() // keine dritte Datenzeile
  })

  it('lässt getExportablePositions (Prüfansicht/Vorschau) unzusammengefasst, auch bei gleicher Warennummer', () => {
    const invoice = makeInvoice([
      makePosition({ id: 'p1', customsCode: '39235000' }),
      makePosition({ id: 'p2', customsCode: '39235000' }),
    ])

    const result = getExportablePositions(invoice)
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('buildExportRow lässt Spalte F (Bestimmungsmitgliedstaat), O (statistischer Wert) und P (USt-IdNr.) bei Eingangsrechnungen leer', () => {
    const invoice = {
      ...makeInvoice([]),
      richtung: 'E' as const,
      destinationCountry: { code: 'NL', source: 'ai' as const, isManual: false },
      versendungsMitgliedstaat: 'NL',
      bestimmungsBundesland: '09',
      ursprungsBundesland: '',
      ursprungsland: 'NL',
      vatId: 'NL123456789B01',
    }
    const row = buildExportRow(invoice, makePosition({ statisticalValueEurRounded: 999 }))
    expect(row.bestimmungsMitgliedstaat).toBe('')
    expect(row.statistischerWertEur).toBe('')
    expect(row.vatId).toBe('')
    expect(row.bestimmungsBundesland).toBe('09')
    expect(row.versendungsMitgliedstaat).toBe('NL')
    expect(row.ursprungsland).toBe('NL')
  })

  it('erzeugt den Dateinamen im Format MM-JJJJ.xlsx', () => {
    expect(buildExportFileName('08', '2026')).toBe('08-2026.xlsx')
  })

  it('stellt bei Angabe ein Firmen-Präfix voran (KST-MM-JJJJ.xlsx)', () => {
    expect(buildExportFileName('08', '2026', 'KST')).toBe('KST-08-2026.xlsx')
    expect(buildExportFileName('08', '2026', 'KSPC')).toBe('KSPC-08-2026.xlsx')
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
