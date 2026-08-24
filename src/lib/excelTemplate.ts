import ExcelJS from 'exceljs'
import type { Invoice, InvoiceDirection, InvoicePosition } from '../types'
import templateUrl from '../assets/Mustertabelle.xlsx?url'

/** Datenstand der fest hinterlegten Mustertabelle (TT.MM.JJJJ), zur Anzeige in der App. */
export const MUSTERTABELLE_STAND = '22.08.2026'

/**
 * Lädt die fest im Projekt hinterlegte Mustertabelle. Sie ist Teil des
 * Anwendungspakets und muss nicht manuell hochgeladen werden.
 */
export async function loadBundledTemplate(): Promise<TemplateInfo> {
  const response = await fetch(templateUrl)
  if (!response.ok) {
    throw new Error(`Die hinterlegte Mustertabelle konnte nicht geladen werden (HTTP ${response.status}).`)
  }
  const buffer = await response.arrayBuffer()
  return loadTemplate(buffer)
}

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
  richtung: InvoiceDirection
  bezugsmonat: string // Spalte B, "MM"
  artDesGeschaeftes: '11'
  verkehrszweig: '3'
  versendungsMitgliedstaat: string // Spalte E – bei Ausgang immer leer, bei Eingang gelesen/manuell
  bestimmungsMitgliedstaat: string // Spalte F – bei Ausgang ISO-Code, entfällt bei Eingang (immer leer)
  bestimmungsBundesland: string // Spalte G – bei Ausgang immer leer, bei Eingang fest "09"
  ursprungsBundesland: string // Spalte H – bei Ausgang fest "09", entfällt bei Eingang (immer leer)
  ursprungsland: string // Spalte I – bei Ausgang immer "DE", bei Eingang gelesen/manuell
  warennummer: string // Spalte J, 8-stellig, als Text
  warenbezeichnung: '' // Spalte K, immer leer
  eigenmasseKg: number // Spalte L
  besondereMasseinheit: number | '' // Spalte M
  rechnungsbetragEur: number // Spalte N
  statistischerWertEur: number | '' // Spalte O – entfällt bei Eingang (immer leer)
  vatId: string // Spalte P
}

/**
 * Vergleicht zwei Positionen nach Warennummer (Spalte J), damit der Export
 * je Rechnung nach Warennummer sortiert ausgegeben werden kann. Positionen
 * ohne (gültige) Warennummer werden ans Ende gestellt; bei gleicher
 * Warennummer bleibt die ursprüngliche Reihenfolge erhalten (stabile
 * Sortierung).
 */
function compareByCustomsCode(a: InvoicePosition, b: InvoicePosition): number {
  const codeA = a.customsCode ?? ''
  const codeB = b.customsCode ?? ''
  if (codeA === '' && codeB === '') return 0
  if (codeA === '') return 1
  if (codeB === '') return -1
  return codeA.localeCompare(codeB)
}

/**
 * Liefert die für den Export relevanten Positionen einer Rechnung – ohne
 * Gutschriften/Storno/Rabatte und ohne Frachtkosten-Positionen (Artikelnummer
 * 090025) – sortiert nach Warennummer. Wird sowohl für den Excel-Export
 * (zusätzlich über `mergeExportPositions` zusammengefasst) als auch für die
 * Vorschau verwendet, damit beide auf denselben Positionen basieren. Die
 * Prüfansicht (Schritt 4) und die Vorschau (Schritt 5) zeigen bewusst JEDE
 * Position einzeln (keine Zusammenfassung gleicher Warennummern), damit
 * Detailfehler pro Position erkennbar bleiben – nur die tatsächlich
 * geschriebene Excel-Datei fasst gleiche Warennummern einer Rechnung
 * zusammen.
 */
export function getExportablePositions(invoice: Invoice): InvoicePosition[] {
  return invoice.positions
    .filter((p) => !p.isCreditOrDiscountOrNegative && !p.isTransportCost && !p.isMtzSurcharge)
    .slice()
    .sort(compareByCustomsCode)
}

/**
 * Fasst mehrere Positionen einer Rechnung mit derselben (gültigen)
 * Warennummer zu EINER Export-Zeile zusammen (Eigenmasse, Rechnungsbetrag,
 * statistischer Wert sowie – bei Warennummer 39233010 – die Menge werden
 * aufsummiert). Gilt ausschließlich für den geschriebenen Excel-Export;
 * Prüfansicht und Vorschau zeigen weiterhin jede Position einzeln, damit
 * Fehler pro Position erkennbar bleiben. Setzt voraus, dass `positions`
 * bereits nach Warennummer sortiert ist (siehe `getExportablePositions`),
 * damit gleiche Warennummern direkt aufeinanderfolgen.
 */
function mergeExportPositions(positions: InvoicePosition[]): InvoicePosition[] {
  const merged: InvoicePosition[] = []
  for (const position of positions) {
    const previous = merged[merged.length - 1]
    if (previous && position.customsCode && previous.customsCode === position.customsCode) {
      merged[merged.length - 1] = {
        ...previous,
        calculatedWeightKgRounded: (previous.calculatedWeightKgRounded ?? 0) + (position.calculatedWeightKgRounded ?? 0),
        amountEurRounded: (previous.amountEurRounded ?? 0) + (position.amountEurRounded ?? 0),
        statisticalValueEurRounded: (previous.statisticalValueEurRounded ?? 0) + (position.statisticalValueEurRounded ?? 0),
        quantity: previous.isSpecialUnit ? (previous.quantity ?? 0) + (position.quantity ?? 0) : previous.quantity,
      }
    } else {
      merged.push(position)
    }
  }
  return merged
}

export function buildExportRow(invoice: Invoice, position: InvoicePosition): ExportRow {
  // Bei Eingangsrechnungen entfallen die Spalten F (Bestimmungsmitgliedstaat),
  // O (statistischer Wert) und P (USt-IdNr.) vollständig – sie bleiben leer.
  const isEingang = invoice.richtung === 'E'
  return {
    richtung: invoice.richtung,
    bezugsmonat: invoice.referenceMonth ?? '',
    artDesGeschaeftes: '11',
    verkehrszweig: '3',
    versendungsMitgliedstaat: invoice.versendungsMitgliedstaat ?? '',
    bestimmungsMitgliedstaat: isEingang ? '' : (invoice.destinationCountry?.code ?? ''),
    bestimmungsBundesland: invoice.bestimmungsBundesland ?? '',
    ursprungsBundesland: invoice.ursprungsBundesland ?? '',
    ursprungsland: invoice.ursprungsland ?? '',
    warennummer: position.customsCode ?? '',
    warenbezeichnung: '',
    eigenmasseKg: position.calculatedWeightKgRounded ?? 0,
    besondereMasseinheit: position.isSpecialUnit ? Math.round(position.quantity ?? 0) : '',
    rechnungsbetragEur: position.amountEurRounded ?? 0,
    statistischerWertEur: isEingang ? '' : (position.statisticalValueEurRounded ?? 0),
    vatId: isEingang ? '' : (invoice.vatId ?? ''),
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
    mergeExportPositions(getExportablePositions(invoice)).map((p) => buildExportRow(invoice, p)),
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
    if (row.statistischerWertEur === '') {
      excelRow.getCell(15).value = null
    } else {
      setNumberCell(excelRow, 15, row.statistischerWertEur)
    }
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

/**
 * `companyPrefix` kennzeichnet die exportierte Datei firmenspezifisch (z. B.
 * "KST" für Kläger Spraying Technology, "KSPC" für Kläger Performance
 * Components) – siehe COMPANY_THEME in App.tsx.
 */
export function buildExportFileName(month: string, year: string, companyPrefix?: string): string {
  return companyPrefix ? `${companyPrefix}-${month}-${year}.xlsx` : `${month}-${year}.xlsx`
}

/**
 * Erzeugt den Export auf Basis einer FRISCH geladenen Mustertabelle. Dadurch
 * bleiben bei mehrfachem Export keine Zeilen eines früheren Durchlaufs stehen.
 *
 * Ist `customTemplate` gesetzt (über „Mustertabelle ersetzen“ hochgeladen),
 * wird diese anstelle der hinterlegten Mustertabelle verwendet – ebenfalls
 * jedes Mal frisch aus der Datei neu geladen.
 */
export async function createExportBuffer(
  invoices: Invoice[],
  customTemplate?: File,
): Promise<ExcelJS.Buffer> {
  const template = customTemplate ? await loadTemplate(customTemplate) : await loadBundledTemplate()
  return buildExportWorkbook(template, invoices)
}
