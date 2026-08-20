import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type PdfExtractionResult = {
  text: string
  ocrUsed: boolean
  extractionFailed: boolean
}

const MIN_TEXT_LENGTH_PER_PAGE = 20

/**
 * Extrahiert den Text aus einer PDF-Datei. Enthält eine Seite keinen (oder
 * kaum) auslesbaren Text, wird versucht, sie per OCR (Tesseract.js) zu
 * erkennen. Schlägt auch das fehl, wird `extractionFailed: true` gesetzt –
 * die Rechnung muss dann als "manuelle Prüfung erforderlich" markiert werden
 * und darf NICHT automatisch weiterverarbeitet werden.
 */
export async function extractPdfText(file: File): Promise<PdfExtractionResult> {
  const arrayBuffer = await file.arrayBuffer()
  let ocrUsed = false
  let extractionFailed = false
  const pageTexts: string[] = []

  try {
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const textContent = await page.getTextContent()
      const text = joinTextItemsWithLineBreaks(textContent.items)

      if (text.trim().length >= MIN_TEXT_LENGTH_PER_PAGE) {
        pageTexts.push(text)
        continue
      }

      // Fallback: Seite rastern und per OCR erkennen
      try {
        const ocrText = await ocrPage(page)
        ocrUsed = true
        if (ocrText.trim().length > 0) {
          pageTexts.push(ocrText)
        } else {
          extractionFailed = true
        }
      } catch {
        extractionFailed = true
      }
    }
  } catch {
    return { text: '', ocrUsed: false, extractionFailed: true }
  }

  const combined = pageTexts.join('\n')
  if (combined.trim().length === 0) {
    extractionFailed = true
  }

  return { text: combined, ocrUsed, extractionFailed }
}

/**
 * pdf.js liefert Textfragmente ohne Zeilenumbrüche. Für die Feld-Erkennung
 * (regex-basiert, zeilenorientiert) müssen Umbrüche anhand der vertikalen
 * Position (transform[5] = y-Koordinate der Baseline) rekonstruiert werden:
 * ein deutlicher y-Sprung zwischen zwei Textfragmenten markiert eine neue
 * Zeile.
 */
function joinTextItemsWithLineBreaks(items: unknown[]): string {
  const Y_TOLERANCE = 2

  type Fragment = { str: string; x: number; y: number }
  const fragments: Fragment[] = []

  for (const raw of items) {
    const item = raw as { str?: string; transform?: number[] }
    if (!item.str) continue
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0]
    fragments.push({ str: item.str, x: transform[4] ?? 0, y: transform[5] ?? 0 })
  }

  if (fragments.length === 0) return ''

  let currentLine: Fragment[] = [fragments[0]]
  const lines: Fragment[][] = [currentLine]

  for (let i = 1; i < fragments.length; i++) {
    const previous = currentLine[currentLine.length - 1]
    const fragment = fragments[i]
    if (Math.abs(fragment.y - previous.y) > Y_TOLERANCE) {
      currentLine = [fragment]
      lines.push(currentLine)
    } else {
      currentLine.push(fragment)
    }
  }

  return lines
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((f) => f.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n')
}

async function ocrPage(page: pdfjsLib.PDFPageProxy): Promise<string> {
  const viewport = page.getViewport({ scale: 2.0 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas-Kontext nicht verfügbar')

  await page.render({ canvasContext: context, viewport, canvas }).promise

  const { recognize } = await import('tesseract.js')
  const result = await recognize(canvas, 'deu')
  return result.data.text
}
