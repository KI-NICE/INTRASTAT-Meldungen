import { linesToText, type DocumentText, type TextLine, type TextSegment } from '../documentText'

/** [Text, x-Position, fett?] */
export type SegmentSpec = [string, number, boolean?]

/** 'BLANK' erzeugt einen Absatzabstand vor der nächsten Zeile. */
export type LineSpec = SegmentSpec[] | 'BLANK'

const FONT_SIZE = 10
const CHAR_WIDTH = FONT_SIZE * 0.5

/**
 * Baut eine DocumentText-Struktur für Tests: Zeilen mit x-Positionen und
 * Fettdruck, wie sie der PDF-Extraktor liefert.
 */
export function buildDocument(specs: LineSpec[]): DocumentText {
  const lines: TextLine[] = []
  let y = 800
  let pendingParagraphBreak = false

  for (const spec of specs) {
    if (spec === 'BLANK') {
      pendingParagraphBreak = true
      continue
    }

    const segments: TextSegment[] = [...spec]
      .sort((a, b) => a[1] - b[1])
      .map(([text, x, bold]) => ({
        text,
        x,
        endX: x + text.length * CHAR_WIDTH,
        bold: bold === true,
        size: FONT_SIZE,
      }))

    lines.push({
      y,
      segments,
      text: segments
        .map((s) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      paragraphBreak: pendingParagraphBreak,
    })

    pendingParagraphBreak = false
    y -= 14
  }

  return { lines, text: linesToText(lines), hasFontInfo: true }
}
