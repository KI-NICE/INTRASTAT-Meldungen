import ExcelJS from 'exceljs'
import type { Invoice, InvoicePosition } from '../types'

export type TemplateInfo = {
  workbook: ExcelJS.Workbook
  worksheetName: string
  headerRowCount: number
}

const DATA_START_ROW = 3 // Zeile 1 = Kopfzeile, Zeile 2 = Hinweiszeile der Mustertabelle (bleiben erhalten)

type LoadableSource = File | ArrayBuffer | Uint8Array

async function toArrayBufferLike(source: LoadableSource): Promise<ArrayBuffer | Uint8Array> {
  // Hinweis: bewusst kein `instanceof ArrayBuffer`/`instanceof Uint8Array`, da
  // in Testumgebungen (jsdom) und im Browser unterschiedliche globale
  // Realms zu falschen Ergebnissen führen können. Stattdessen anhand der
  // File/Blob-typischen Methode `arrayBuffer()` unterscheiden.
  if (typeof (source as File).arrayBuffer === 'function' && typeof (source as File).size === 'number') {
    return await (source as File).arrayBuffer()
  }
  return source as ArrayBuffer | Uint8Array
}

/** Lädt die Mustertabelle.xlsx und liefert das Workbook zur Weiterverarbeitung (Struktur bleibt erhalten). */
export async function loadTemplate(file: LoadableSource): Promise<TemplateInfo> {
  const arrayBuffer = await toArrayBufferLike(file)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuffer as ExcelJS.Buffer)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error('Die Mustertabelle enthält kein Arbeitsblatt.')
  return { workbook, worksheetName: worksheet.name, headerRowCount: DATA_START_ROW - 1 }
}

export type ExportRow = {
  richtung: 'V'
  bezugsmonat: string // Spalte B, "MM"
  artDesGeschaeftes: '11'
  verkehrszweig: '3'
  versendungsMitgliedstaat: '' // Spalte E, immer leer (nur Eingang)
  bestimmungsMitgliedstaat: string // Spalte F, ISO-Code
  bestimmungsBundesland: '' // Spalte G, immer leer (nur Eingang)
  ursprungsBundesland: '09' // Spalte H
  ursprungsland: 'DE' // Spalte I
  warennummer: string // Spalte J, 8-stellig, als Text
  warenbezeichnung: '' // Spalte K, immer leer
  eigenmasseKg: number // Spalte L
  besondereMasseinheit: number | '' // Spalte M
  rechnungsbetragEur: number // Spalte N
  statistischerWertEur: number // Spalte O
  vatId: string // Spalte P
}

export function buildExportRow(invoice: Invoice, position: InvoicePosition): ExportRow {
  return {
    richtung: 'V',
    bezugsmonat: invoice.referenceMonth ?? '',
    artDesGeschaeftes: '11',
    verkehrszweig: '3',
    versendungsMitgliedstaat: '',
    bestimmungsMitgliedstaat: invoice.destinationCountry?.code ?? '',
    bestimmungsBundesland: '',
    ursprungsBundesland: '09',
    ursprungsland: 'DE',
    warennummer: position.customsCode ?? '',
    warenbezeichnung: '',
    eigenmasseKg: position.calculatedWeightKgRounded ?? 0,
    besondereMasseinheit: position.isSpecialUnit ? Math.round(position.quantity ?? 0) : '',
    rechnungsbetragEur: position.amountEurRounded ?? 0,
    statistischerWertEur: position.statisticalValueEurRounded ?? 0,
    vatId: invoice.vatId ?? '',
  }
}

/**
 * Schreibt alle Exportzeilen (eine je relevanter Rechnungsposition) ab
 * Zeile 3 in die geladene Mustertabelle und gibt den fertigen Workbook-Buffer
 * zurück. Interne Hilfsspalten/-tabellen werden nicht mitgeschrieben.
 */
export async function buildExportWorkbook(
  template: TemplateInfo,
  invoices: Invoice[],
): Promise<ExcelJS.Buffer> {
  const worksheet = template.workbook.worksheets[0]

  const rows: ExportRow[] = invoices.flatMap((invoice) =>
    invoice.positions.filter((p) => !p.isCreditOrDiscountOrNegative).map((p) => buildExportRow(invoice, p)),
  )

  rows.forEach((row, index) => {
    const excelRow = worksheet.getRow(DATA_START_ROW + index)

    setTextCell(excelRow, 1, row.richtung)
    setTextCell(excelRow, 2, row.bezugsmonat)
    setTextCell(excelRow, 3, row.artDesGeschaeftes)
    setTextCell(excelRow, 4, row.verkehrszweig)
    setTextCell(excelRow, 5, row.versendungsMitgliedstaat)
    setTextCell(excelRow, 6, row.bestimmungsMitgliedstaat)
    setTextCell(excelRow, 7, row.bestimmungsBundesland)
    setTextCell(excelRow, 8, row.ursprungsBundesland)
    setTextCell(excelRow, 9, row.ursprungsland)
    setTextCell(excelRow, 10, row.warennummer)
    setTextCell(excelRow, 11, row.warenbezeichnung)
    setNumberCell(excelRow, 12, row.eigenmasseKg)
    if (row.besondereMasseinheit === '') {
      excelRow.getCell(13).value = null
    } else {
      setNumberCell(excelRow, 13, row.besondereMasseinheit)
    }
    setNumberCell(excelRow, 14, row.rechnungsbetragEur)
    setNumberCell(excelRow, 15, row.statistischerWertEur)
    setTextCell(excelRow, 16, row.vatId)

    excelRow.commit()
  })

  return await template.workbook.xlsx.writeBuffer()
}

function setTextCell(row: ExcelJS.Row, colNumber: number, value: string): void {
  const cell = row.getCell(colNumber)
  cell.value = value
  cell.numFmt = '@'
}

function setNumberCell(row: ExcelJS.Row, colNumber: number, value: number): void {
  const cell = row.getCell(colNumber)
  cell.value = value
}

export function buildExportFileName(month: string, year: string): string {
  return `${month}-${year}.xlsx`
}
