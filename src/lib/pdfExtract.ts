// Bewusst der "legacy"-Build: pdf.js 6 setzt im Standard-Build sehr neue
// JavaScript-Methoden voraus (z. B. Map.prototype.getOrInsertComputed), die
// aktuelle Browser noch nicht mitbringen. Der legacy-Build liefert die
// nötigen Polyfills mit – ohne ihn schlagen getOperatorList() (Fettdruck-
// Erkennung) und das Rendern für OCR fehl.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import {
  documentTextFromPlainText,
  linesToText,
  mergeDocumentTexts,
  type DocumentText,
  type TextLine,
  type TextSegment,
} from './documentText'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Für die Fettdruck-Erkennung müssen die Schriftobjekte aufgelöst werden.
// Bei Rechnungen mit Standard-Schriften (nicht eingebettet) benötigt pdf.js
// dafür die mitgelieferten Schriftdaten – sie liegen im Anwendungspaket.
const ASSET_BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`
const STANDARD_FONT_DATA_URL = `${ASSET_BASE}standard_fonts/`
const CMAP_URL = `${ASSET_BASE}cmaps/`

export type PdfExtractionResult = {
  document: DocumentText
  ocrUsed: boolean
  extractionFailed: boolean
}

const MIN_TEXT_LENGTH_PER_PAGE = 20
const Y_TOLERANCE = 2

/**
 * Extrahiert Text samt Layout- und Fettdruck-Information aus einer PDF.
 * Enthält eine Seite keinen auslesbaren Text, wird OCR (Tesseract.js)
 * versucht – dann stehen allerdings keine Schriftinformationen zur Verfügung
 * (`hasFontInfo: false`), und die Rechnung wird zur manuellen Prüfung
 * gekennzeichnet.
 */
export async function extractPdfText(file: File): Promise<PdfExtractionResult> {
  const arrayBuffer = await file.arrayBuffer()
  let ocrUsed = false
  let extractionFailed = false
  const parts: DocumentText[] = []

  try {
    const doc = await pdfjsLib.getDocument({
      data: arrayBuffer,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
    }).promise

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const pageText = await extractPageText(page)

      if (pageText.text.trim().length >= MIN_TEXT_LENGTH_PER_PAGE) {
        parts.push(pageText)
        continue
      }

      try {
        const ocrText = await ocrPage(page)
        ocrUsed = true
        if (ocrText.trim().length > 0) {
          parts.push(documentTextFromPlainText(ocrText))
        } else {
          extractionFailed = true
        }
      } catch {
        extractionFailed = true
      }
    }
  } catch {
    return { document: documentTextFromPlainText(''), ocrUsed: false, extractionFailed: true }
  }

  const merged = mergeDocumentTexts(parts)
  if (merged.text.trim().length === 0) extractionFailed = true

  return { document: merged, ocrUsed, extractionFailed }
}

/** Ermittelt je Schrift-Kennung, ob es sich um eine fette Schrift handelt. */
async function buildBoldFontMap(page: pdfjsLib.PDFPageProxy, fontNames: Set<string>): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()

  // Nötig, damit die Schriftobjekte aufgelöst in commonObjs/objs vorliegen.
  // Schlägt das fehl, wird trotzdem ein Zugriff versucht – gelingt auch der
  // nicht, bleibt die Map leer und die Rechnung wird als „ohne Fettdruck“
  // gekennzeichnet.
  try {
    await page.getOperatorList()
  } catch {
    // Fehlgeschlagen – Zugriff wird trotzdem versucht.
  }

  for (const fontName of fontNames) {
    for (const store of [page.commonObjs, page.objs]) {
      try {
        const obj = (store as unknown as { get?: (id: string) => unknown })?.get?.(fontName)
        const data = (obj as { data?: unknown })?.data ?? obj
        const font = data as { bold?: boolean; black?: boolean; name?: string } | undefined
        if (!font || (font.bold === undefined && font.name === undefined)) continue
        // Nur setzen, wenn die Schrift wirklich aufgelöst wurde – so bleibt
        // unterscheidbar, ob „nicht fett“ oder „keine Information“ vorliegt.
        map.set(
          fontName,
          font.bold === true || font.black === true || /bold|black|heavy|semib|demib/i.test(font.name ?? ''),
        )
        break
      } catch {
        // nächste Quelle versuchen
      }
    }
  }
  return map
}

async function extractPageText(page: pdfjsLib.PDFPageProxy): Promise<DocumentText> {
  const textContent = await page.getTextContent()

  type Raw = { text: string; x: number; endX: number; y: number; size: number; fontName: string }
  const raws: Raw[] = []
  const fontNames = new Set<string>()

  for (const rawItem of textContent.items) {
    const item = rawItem as {
      str?: string
      transform?: number[]
      width?: number
      height?: number
      fontName?: string
    }
    if (!item.str || item.str.trim().length === 0) continue
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0]
    const x = transform[4] ?? 0
    const fontName = item.fontName ?? ''
    fontNames.add(fontName)
    raws.push({
      text: item.str,
      x,
      endX: x + (item.width ?? 0),
      y: transform[5] ?? 0,
      size: item.height ?? 0,
      fontName,
    })
  }

  if (raws.length === 0) return { lines: [], text: '', hasFontInfo: false }

  const boldMap = await buildBoldFontMap(page, fontNames)
  const hasFontInfo = boldMap.size > 0

  // Fragmente zu Zeilen gruppieren (gleiche Baseline innerhalb Toleranz)
  const groups: Raw[][] = []
  let current: Raw[] = [raws[0]]
  groups.push(current)
  const gaps: number[] = []

  for (let i = 1; i < raws.length; i++) {
    const previous = current[current.length - 1]
    const raw = raws[i]
    const gap = Math.abs(raw.y - previous.y)
    if (gap > Y_TOLERANCE) {
      gaps.push(gap)
      current = [raw]
      groups.push(current)
    } else {
      current.push(raw)
    }
  }

  // Absatzabstand über den Median der Zeilenabstände bestimmen
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const medianGap = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0
  const paragraphThreshold = medianGap > 0 ? medianGap * 1.8 : Number.POSITIVE_INFINITY

  const lines: TextLine[] = groups.map((group, index) => {
    const sorted = [...group].sort((a, b) => a.x - b.x)
    const segments: TextSegment[] = sorted.map((raw) => ({
      text: raw.text.trim(),
      x: raw.x,
      endX: raw.endX,
      bold: boldMap.get(raw.fontName) ?? false,
      size: raw.size,
    }))

    const previousY = index > 0 ? groups[index - 1][0].y : undefined
    const paragraphBreak =
      previousY != null && Math.abs(group[0].y - previousY) > paragraphThreshold

    return {
      y: group[0].y,
      segments,
      text: segments
        .map((s) => s.text)
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim(),
      paragraphBreak,
    }
  })

  return { lines, text: linesToText(lines), hasFontInfo }
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
  const result = await recognize(canvas, 'deu+eng')
  return result.data.text
}
