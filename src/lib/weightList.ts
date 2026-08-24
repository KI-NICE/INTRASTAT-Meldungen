import ExcelJS from 'exceljs'

/**
 * Liest eine Artikel-Gewichtsmapping-Datei ein (Format wie
 * "Artikel-Gewichtsmapping.xlsx": Spalte A = Artikelnummer, Spalte D =
 * Gewicht je Stück in Gramm) und liefert eine Zuordnung Artikelnummer →
 * Gewicht in Gramm. Gilt ausschließlich für Ausgangsrechnungen.
 *
 * Die erste Zeile gilt als Kopfzeile und wird übersprungen. Zeilen ohne
 * Artikelnummer oder ohne eine als Zahl lesbare Spalte D werden ausgelassen.
 */
export async function parseArtikelGewichtsmappingXlsx(
  file: File | ArrayBuffer,
): Promise<Record<string, number>> {
  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuffer as ExcelJS.Buffer)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return {}

  const mapping: Record<string, number> = {}

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // Kopfzeile

    const articleNumber = cellString(row.getCell(1).value)
    const grams = cellNumber(row.getCell(4).value)
    if (!articleNumber || grams == null) return

    mapping[articleNumber] = grams
  })

  return mapping
}

function cellString(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'object' && 'result' in value && value.result != null) {
    return String(value.result).trim()
  }
  if (typeof value === 'object' && 'text' in value && value.text != null) {
    return String(value.text).trim()
  }
  return String(value).trim()
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'object' && 'result' in value && typeof value.result === 'number') {
    return value.result
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
