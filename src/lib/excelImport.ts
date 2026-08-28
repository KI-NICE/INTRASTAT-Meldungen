import ExcelJS from 'exceljs'
import type { DestinationCountryInfo, Invoice, InvoiceDirection, InvoicePosition } from '../types'
import { deriveReferencePeriod, isNonMerchandiseArticleNumber } from './aiInvoiceBuilder'
import { recalculateInvoice } from './processing'
import { cellNumber, cellString } from './weightList'

/**
 * Liest Ausgangsrechnungen aus einer strukturierten Excel-Datei ein (Export
 * der Buchhaltung: eine Zeile je Rechnungsposition, mehrere Zeilen je
 * Rechnungsnummer) – komplett lokal, ohne jede externe Anbindung. Jede
 * Rechnung wird direkt über `recalculateInvoice` mit der bestehenden
 * Gewichtsliste, Validierung usw. weiterverarbeitet, exakt wie bei manuell
 * erfassten Rechnungen.
 *
 * Spalten (1-basiert):
 *   A RENR  Rechnungsnummer          B RGDA  Rechnungsdatum (JJJJMMTT)
 *   C IDLD  Länderkennung USt-IdNr.  D IDNR  USt-IdNr. ohne Länderpräfix
 *   E AFHP  Positionsnummer          F TENR  Teile-/Artikelnummer
 *   G BEZG  Artikelbezeichnung 1     H BEZG  Artikelbezeichnung 2
 *   I MENG  Menge in Stück           J       Positionswert in EUR
 *   K GWNE  Nettogewicht/Stück – IGNORIERT (eigene Gewichtsliste im Tool)
 *   L KDNR  Kundennummer             M NAME  Kundenname 1
 *   N NAME  Kundenname 2 (i. d. R. leer)
 *   O STRA  Straße                  P WORT  Ort
 *   Q ZOTA  Zolltarifnummer (8-stellig)
 *
 * Die erste Zeile gilt als Kopfzeile und wird übersprungen.
 */
const COL = {
  RENR: 1,
  RGDA: 2,
  IDLD: 3,
  IDNR: 4,
  AFHP: 5,
  TENR: 6,
  BEZG1: 7,
  BEZG2: 8,
  MENG: 9,
  WERT: 10,
  KDNR: 12,
  NAME1: 13,
  STRA: 15,
  WORT: 16,
  ZOTA: 17,
} as const

type ExcelRow = {
  rgda: string
  idld: string
  idnr: string
  afhp: string
  tenr: string
  bezg1: string
  bezg2: string
  meng: number | null
  wert: number | null
  kdnr: string
  name1: string
  stra: string
  wort: string
  zota: string
}

let excelInvoiceCounter = 0

export async function parseExcelInvoices(
  file: File,
  weightMaps: Record<InvoiceDirection, Record<string, number>>,
  selectedMonth: string,
  selectedYear: string,
): Promise<Invoice[]> {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuffer as ExcelJS.Buffer)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  const rowsByInvoice = new Map<string, ExcelRow[]>()

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // Kopfzeile
    const renr = cellString(row.getCell(COL.RENR).value)
    if (!renr) return

    const entry: ExcelRow = {
      rgda: cellString(row.getCell(COL.RGDA).value),
      idld: cellString(row.getCell(COL.IDLD).value),
      idnr: cellString(row.getCell(COL.IDNR).value),
      afhp: cellString(row.getCell(COL.AFHP).value),
      tenr: cellString(row.getCell(COL.TENR).value),
      bezg1: cellString(row.getCell(COL.BEZG1).value),
      bezg2: cellString(row.getCell(COL.BEZG2).value),
      meng: cellNumber(row.getCell(COL.MENG).value),
      wert: cellNumber(row.getCell(COL.WERT).value),
      kdnr: cellString(row.getCell(COL.KDNR).value),
      name1: cellString(row.getCell(COL.NAME1).value),
      stra: cellString(row.getCell(COL.STRA).value),
      wort: cellString(row.getCell(COL.WORT).value),
      zota: cellString(row.getCell(COL.ZOTA).value),
    }
    const list = rowsByInvoice.get(renr) ?? []
    list.push(entry)
    rowsByInvoice.set(renr, list)
  })

  const invoices: Invoice[] = []
  for (const [renr, rows] of rowsByInvoice) {
    invoices.push(buildInvoiceFromRows(renr, rows, weightMaps, selectedMonth, selectedYear))
  }
  return invoices
}

function buildInvoiceFromRows(
  renr: string,
  rows: ExcelRow[],
  weightMaps: Record<InvoiceDirection, Record<string, number>>,
  selectedMonth: string,
  selectedYear: string,
): Invoice {
  const first = rows[0]
  const invoiceDateRaw = formatDateFromJjjjmmtt(first.rgda)
  const period = deriveReferencePeriod(invoiceDateRaw)
  const destinationCountry = resolveDestinationCountryFromIdld(first.idld)
  const vatId = first.idld && first.idld !== '99' && first.idnr ? `${first.idld}${first.idnr}` : undefined

  excelInvoiceCounter += 1
  const invoice: Invoice = {
    id: `excel-${excelInvoiceCounter}-${renr}`,
    fileName: renr,
    richtung: 'V',
    language: 'de',
    invoiceNumber: renr,
    invoiceDateRaw,
    referenceMonth: period?.month,
    referenceYear: period?.year,
    destinationCountry,
    destinationAddressText: [first.name1, first.stra, first.wort].filter(Boolean).join('\n') || undefined,
    vatId,
    versendungsMitgliedstaat: '',
    bestimmungsBundesland: '',
    ursprungsBundesland: '09',
    ursprungsland: 'DE',
    positions: buildPositions(rows),
    manualCorrections: [],
    issues: [],
    status: 'pending',
  }

  return recalculateInvoice(invoice, weightMaps, selectedMonth, selectedYear)
}

function buildPositions(rows: ExcelRow[]): InvoicePosition[] {
  return attributeMtzToPreviousPosition(rows.map(buildPositionFromRow))
}

function buildPositionFromRow(row: ExcelRow, index: number): InvoicePosition {
  const articleNumberRaw = row.tenr || undefined
  const isTransportCost = isNonMerchandiseArticleNumber(articleNumberRaw)
  const customsCode = row.zota ? row.zota.replace(/\D/g, '') || undefined : undefined
  const amountEur = row.wert ?? undefined
  const isCreditOrDiscountOrNegative = !isTransportCost && amountEur != null && amountEur < 0

  return {
    id: `pos-${index + 1}-${row.afhp || index + 1}`,
    lineNo: index + 1,
    positionNumber: row.afhp || undefined,
    productNameRaw: [row.bezg1, row.bezg2].filter(Boolean).join(' '),
    customsCodeRaw: row.zota || undefined,
    customsCode,
    quantityRaw: row.meng != null ? String(row.meng) : undefined,
    quantity: row.meng ?? undefined,
    amountRaw: amountEur != null ? String(amountEur) : undefined,
    amountEur,
    isSpecialUnit: customsCode === '39233010',
    articleNumberRaw,
    isTransportCost,
    isMtzSurcharge: false,
    isCreditOrDiscountOrNegative,
    negativeReason: isCreditOrDiscountOrNegative ? 'negativer Positionsbetrag' : undefined,
    manualCorrections: [],
    issues: [],
    status: 'ok',
    requiresManualDecision: isCreditOrDiscountOrNegative,
  }
}

/** Vom Nutzer bestätigte Artikelnummern für Materialteuerungszuschlag-Positionen. */
const MTZ_ARTICLE_NUMBERS = new Set(['090038', '090039', '090040', '090041', '090042', '090044', '090045'])

function isMtzText(text: string): boolean {
  return /material.?teuerungszuschlag|\bmtz\b/i.test(text)
}

/**
 * Eine Position gilt als Materialteuerungszuschlag, wenn ihre Artikelnummer
 * zu MTZ_ARTICLE_NUMBERS gehört – das ist das maßgebliche Kriterium. Die
 * Bezeichnung ("Material-Teuerungszuschlag"/"MTZ") dient nur zusätzlich als
 * Erkennungsmerkmal für den Fall einer noch nicht bekannten Artikelnummer.
 */
function isMtzPosition(position: InvoicePosition): boolean {
  if (position.articleNumberRaw && MTZ_ARTICLE_NUMBERS.has(position.articleNumberRaw)) return true
  return isMtzText(position.productNameRaw)
}

function isMerchandisePositionLike(position: InvoicePosition): boolean {
  return !position.isCreditOrDiscountOrNegative && !position.isTransportCost && !position.isMtzSurcharge
}

/**
 * Ordnet Materialteuerungszuschlag-Positionen (erkannt an der Artikelnummer,
 * siehe MTZ_ARTICLE_NUMBERS) IMMER der unmittelbar vorangehenden Position
 * der Rechnung zu. Anders als beim PDF-Weg (siehe
 * aiInvoiceBuilder.classifyNonMerchandisePositions) wird NICHT gegen
 * MTZ_ARTIKEL_MAPPING geprüft: Die Artikelnummer ist in der Excel-Struktur
 * bereits eindeutig, und die Positionsreihenfolge ist nicht zuverlässig
 * alternierend (z. B. zwei Artikelpositionen, dann ein einzelner MTZ am
 * Ende einer Rechnung). Ist die unmittelbar vorangehende Position selbst
 * keine Warenposition (z. B. Frachtkosten), bleibt der MTZ als allgemeine
 * "09"-Position stehen und wird wie Frachtkosten anteilig verteilt – es
 * geht nichts verloren.
 */
function attributeMtzToPreviousPosition(positions: InvoicePosition[]): InvoicePosition[] {
  const result = positions.map((p) => ({ ...p }))
  for (let i = 0; i < result.length; i++) {
    const candidate = result[i]
    if (!candidate.isTransportCost || !isMtzPosition(candidate)) continue
    const parent = i > 0 ? result[i - 1] : undefined
    if (!parent || !isMerchandisePositionLike(parent)) continue
    candidate.isTransportCost = false
    candidate.isMtzSurcharge = true
    parent.mtzSurchargeEurRaw = (parent.mtzSurchargeEurRaw ?? 0) + (candidate.amountEur ?? 0)
    parent.amountEur = (parent.amountEur ?? 0) + (candidate.amountEur ?? 0)
  }
  return result
}

function formatDateFromJjjjmmtt(raw: string): string | undefined {
  const digits = raw.trim()
  if (!/^\d{8}$/.test(digits)) return undefined
  return `${digits.slice(6, 8)}.${digits.slice(4, 6)}.${digits.slice(0, 4)}`
}

/**
 * "99" steht für Drittland ohne erkennbares Zielland – ohne Lieferadresse in
 * der Excel-Datei lässt sich das tatsächliche Land nicht ableiten und muss
 * in der Prüfansicht manuell ausgewählt werden. Alle anderen IDLD-Werte sind
 * bereits der ISO-3166-1-Alpha-2-Code.
 */
function resolveDestinationCountryFromIdld(idld: string): DestinationCountryInfo {
  const code = idld.trim().toUpperCase()
  if (!code || code === '99') {
    return { code: null, source: 'unresolved', isManual: false, needsConfirmation: true }
  }
  return { code, source: 'excel', isManual: false, needsConfirmation: false }
}

/** Feste Spalten in der "Zusammenfassenden Meldung": D = Rechnungsdatum, F = Rechnungsnummer. */
const MELDUNG_DATE_COL = 4
const MELDUNG_INVOICE_NUMBER_COL = 6

/**
 * Liest die Rechnungsnummern aus einer "Zusammenfassenden Meldung" ein, die
 * ebenfalls als Excel-Datei bereitgestellt wird (siehe App.tsx, Meldungs-
 * Validierung vor der Prüfung). Die Datei hat EIN Tabellenblatt je Seite
 * (1 Blatt = 1 Seite A4) – es werden deshalb IMMER ALLE Tabellenblätter
 * durchsucht, nicht nur das erste. Je Blatt gilt die erste Zeile als
 * Kopfzeile und wird übersprungen.
 *
 * Eine Zeile zählt nur dann, wenn sowohl Spalte D (Rechnungsdatum) als auch
 * Spalte F (Rechnungsnummer) gefüllt sind – das schließt leere bzw.
 * Summenzeilen aus. Jede Rechnungsnummer wird nur einmal zurückgegeben, auch
 * wenn sie mehrfach vorkommt (mehrere Buchungszeilen derselben Rechnung).
 */
export async function parseExcelMeldungInvoiceNumbers(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuffer as ExcelJS.Buffer)

  const numbers = new Set<string>()
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return // Kopfzeile
      const date = cellString(row.getCell(MELDUNG_DATE_COL).value)
      const invoiceNumber = cellString(row.getCell(MELDUNG_INVOICE_NUMBER_COL).value)
      if (date && invoiceNumber) numbers.add(invoiceNumber)
    })
  }

  return [...numbers]
}
