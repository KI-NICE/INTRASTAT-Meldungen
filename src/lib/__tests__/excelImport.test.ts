// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseExcelInvoices } from '../excelImport'

const HEADER = [
  'RENR', 'RGDA', 'IDLD', 'IDNR', 'AFHP', 'TENR', 'BEZG', 'BEZG', 'MENG', '00010',
  'GWNE', 'KDNR', 'NAME', 'NAME', 'STRA', 'WORT', 'ZOTA',
]

type RowInput = [
  string | number, // RENR
  string | number, // RGDA
  string, // IDLD
  string, // IDNR
  string | number, // AFHP
  string, // TENR
  string, // BEZG1
  string, // BEZG2
  number | null, // MENG
  number | null, // WERT
  number | null, // GWNE
  string | number, // KDNR
  string, // NAME1
  string, // NAME2
  string, // STRA
  string, // WORT
  string | null, // ZOTA
]

async function buildWorkbookFile(rows: RowInput[]): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Blatt1')
  sheet.addRow(HEADER)
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer], 'test.xlsx')
}

const EMPTY_WEIGHT_MAPS = { V: {}, E: {} }

describe('parseExcelInvoices', () => {
  it('gruppiert mehrere Zeilen derselben Rechnungsnummer zu einer Rechnung', async () => {
    const file = await buildWorkbookFile([
      [167890, 20260601, 'AT', 'U40869501', 10, '002007', 'Sprayer K2', 'weiß rot', 500, 430, 0.045, 14748, 'Würth', '', 'Aspermontstrasse 1', 'Chur', '84248970'],
      [167890, 20260601, 'AT', 'U40869501', 20, '041169', 'Pumpspray', 'f. Lösemittel', 780, 4765.8, 0.35, 14748, 'Würth', '', 'Aspermontstrasse 1', 'Chur', '84248970'],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    expect(invoices).toHaveLength(1)
    expect(invoices[0].invoiceNumber).toBe('167890')
    expect(invoices[0].positions).toHaveLength(2)
    expect(invoices[0].richtung).toBe('V')
  })

  it('wandelt das Rechnungsdatum von JJJJMMTT nach TT.MM.JJJJ um und leitet den Bezugsmonat ab', async () => {
    const file = await buildWorkbookFile([
      [167890, 20260601, 'AT', 'U40869501', 10, '002007', 'Sprayer K2', '', 500, 430, 0.045, 14748, 'Würth', '', 'Straße 1', 'Chur', '84248970'],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    expect(invoices[0].invoiceDateRaw).toBe('01.06.2026')
    expect(invoices[0].referenceMonth).toBe('06')
    expect(invoices[0].referenceYear).toBe('2026')
  })

  it('setzt USt-IdNr. aus Länderkennung + IDNR zusammen und übernimmt das Bestimmungsland direkt', async () => {
    const file = await buildWorkbookFile([
      [167890, 20260601, 'AT', 'U40869501', 10, '002007', 'Sprayer K2', '', 500, 430, 0.045, 14748, 'Würth', '', 'Straße 1', 'Chur', '84248970'],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    expect(invoices[0].vatId).toBe('ATU40869501')
    expect(invoices[0].destinationCountry?.code).toBe('AT')
    expect(invoices[0].destinationCountry?.needsConfirmation).toBeFalsy()
  })

  it('markiert Drittland ("99") als ungeklärtes Bestimmungsland ohne USt-IdNr.', async () => {
    const file = await buildWorkbookFile([
      [167889, 20260601, '99', '', 10, '040901', 'DPZ Hobby', '', 780, 5288.4, 0.38, 19206, 'Würth', '', 'Aspermontstrasse 1', 'Chur', '84248970'],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    expect(invoices[0].vatId).toBeUndefined()
    expect(invoices[0].destinationCountry?.code).toBeNull()
    expect(invoices[0].destinationCountry?.needsConfirmation).toBe(true)
  })

  it('behandelt Frachtkosten- und Sonderkosten-Positionen (Artikelnummer beginnt mit 09) gleich als anteilig zu verteilende Position', async () => {
    const file = await buildWorkbookFile([
      [167891, 20260601, 'NL', '008923929B01', 10, '040755', 'Hobby rot schwarz', '', 720, 6320.44, 0.38, 12268, 'LKQ', '', 'Straße 1', 'Tilburg', '84248970'],
      [167891, 20260601, 'NL', '008923929B01', 20, '090025', 'Frachtkosten', '', 1, 318.6, 0, 12268, 'LKQ', '', 'Straße 1', 'Tilburg', null],
      [167891, 20260601, 'NL', '008923929B01', 30, '090024', 'Sonderkosten', '', 1, 50, 0, 12268, 'LKQ', '', 'Straße 1', 'Tilburg', null],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    const positions = invoices[0].positions
    expect(positions.find((p) => p.articleNumberRaw === '090025')?.isTransportCost).toBe(true)
    expect(positions.find((p) => p.articleNumberRaw === '090024')?.isTransportCost).toBe(true)
    // Beide zusammen anteilig auf die einzige Warenposition verteilt (Spalte N).
    const merchandise = positions.find((p) => p.articleNumberRaw === '040755')
    expect(merchandise?.amountWithFreightEurRaw).toBeCloseTo(6320.44 + 318.6 + 50, 6)
  })

  it('rechnet einen Materialteuerungszuschlag der unmittelbar vorangehenden Position zu, auch wenn davor mehrere Artikel stehen', async () => {
    // Reales Muster (Rechnung 167981): zwei Artikelpositionen, dann ein
    // einzelner MTZ am Ende – muss der UNMITTELBAR vorangehenden Position
    // (040055) zugerechnet werden, nicht der ersten (007073).
    const file = await buildWorkbookFile([
      [167981, 20260615, 'AT', 'U16380002', 10, '007073', 'Sprayer K2', 'mont. a. Zyl.500', 1000, 1850.5, 0.35, 13587, 'Kellner', '', 'Straße 1', 'Wien', '84248970'],
      [167981, 20260615, 'AT', 'U16380002', 20, '040055', 'Hobby 1.0L', 'MS 0,8mm', 1080, 9204.3, 0.38, 13587, 'Kellner', '', 'Straße 1', 'Wien', '84248970'],
      [167981, 20260615, 'AT', 'U16380002', 30, '090045', 'Material-Teuerungszuschlag', '(MTZ) - Sprayer PP+Fl. 5%', 1, 87, 0, 13587, 'Kellner', '', 'Straße 1', 'Wien', null],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    const positions = invoices[0].positions
    const mtz = positions.find((p) => p.articleNumberRaw === '090045')
    const firstArticle = positions.find((p) => p.articleNumberRaw === '007073')
    const secondArticle = positions.find((p) => p.articleNumberRaw === '040055')

    expect(mtz?.isMtzSurcharge).toBe(true)
    expect(mtz?.isTransportCost).toBe(false)
    expect(secondArticle?.mtzSurchargeEurRaw).toBe(87)
    expect(firstArticle?.mtzSurchargeEurRaw).toBeUndefined()
  })

  it('erkennt eine MTZ-Position an der Artikelnummer, auch ohne erkennbaren Text in der Bezeichnung', async () => {
    // 090038 ist laut Nutzer eine der bestätigten MTZ-Artikelnummern – muss
    // auch dann als MTZ erkannt werden, wenn die Bezeichnung selbst nicht
    // "Material-Teuerungszuschlag"/"MTZ" enthält.
    const file = await buildWorkbookFile([
      [167999, 20260615, 'AT', 'U16380002', 10, '007073', 'Sprayer K2', '', 1000, 1850.5, 0.35, 13587, 'Kellner', '', 'Straße 1', 'Wien', '84248970'],
      [167999, 20260615, 'AT', 'U16380002', 20, '090038', 'Zuschlag Rohstoffpreise', '', 1, 42, 0, 13587, 'Kellner', '', 'Straße 1', 'Wien', null],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    const positions = invoices[0].positions
    const mtz = positions.find((p) => p.articleNumberRaw === '090038')
    const article = positions.find((p) => p.articleNumberRaw === '007073')
    expect(mtz?.isMtzSurcharge).toBe(true)
    expect(article?.mtzSurchargeEurRaw).toBe(42)
  })

  it('lässt einen MTZ als allgemeine 09-Position stehen, wenn die vorangehende Position selbst keine Warenposition ist', async () => {
    const file = await buildWorkbookFile([
      [167999, 20260615, 'AT', 'U16380002', 10, '007073', 'Sprayer K2', '', 1000, 1850.5, 0.35, 13587, 'Kellner', '', 'Straße 1', 'Wien', '84248970'],
      [167999, 20260615, 'AT', 'U16380002', 20, '090025', 'Frachtkosten', '', 1, 20, 0, 13587, 'Kellner', '', 'Straße 1', 'Wien', null],
      [167999, 20260615, 'AT', 'U16380002', 30, '090045', 'Material-Teuerungszuschlag', '(MTZ)', 1, 87, 0, 13587, 'Kellner', '', 'Straße 1', 'Wien', null],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    const mtz = invoices[0].positions.find((p) => p.articleNumberRaw === '090045')
    expect(mtz?.isMtzSurcharge).toBe(false)
    expect(mtz?.isTransportCost).toBe(true)
  })

  it('erzeugt für mehrere Rechnungsnummern in derselben Datei mehrere Rechnungen', async () => {
    const file = await buildWorkbookFile([
      [167890, 20260601, 'AT', 'U40869501', 10, '002007', 'Sprayer K2', '', 500, 430, 0.045, 14748, 'Würth', '', 'Straße 1', 'Chur', '84248970'],
      [167924, 20260605, 'AT', 'U16320906', 10, '041067', 'Foamya Pro', '', 20, 403.56, 0.35, 16608, 'Raiffeisen', '', 'Straße 2', 'Absdorf', '84248970'],
    ])
    const invoices = await parseExcelInvoices(file, EMPTY_WEIGHT_MAPS, '06', '2026')
    expect(invoices.map((inv) => inv.invoiceNumber).sort()).toEqual(['167890', '167924'])
  })
})
