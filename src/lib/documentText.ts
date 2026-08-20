/**
 * Strukturierte Darstellung des aus einer PDF gelesenen Textes.
 *
 * Für die Rechnungserkennung genügt reiner Text nicht: Positionsnummern,
 * Mengen und die Rechnungsnummer sind ausschließlich über den **Fettdruck**
 * und die **Spaltenposition** eindeutig identifizierbar (Preise stehen z. B.
 * „per 100“ und dürfen nicht als Menge gelesen werden). Deshalb behalten wir
 * je Textfragment die x-Position, die Schriftgröße und die Information, ob es
 * fett gesetzt ist.
 */

export type TextSegment = {
  text: string
  /** Linke Kante des Fragments. */
  x: number
  /** Geschätzte rechte Kante des Fragments. */
  endX: number
  bold: boolean
  size: number
}

export type TextLine = {
  y: number
  segments: TextSegment[]
  /** Zeileninhalt als Text (Fragmente von links nach rechts). */
  text: string
  /** Abstand zur vorherigen Zeile war deutlich größer (Absatzwechsel). */
  paragraphBreak: boolean
}

export type DocumentText = {
  lines: TextLine[]
  /** Gesamter Text mit Zeilenumbrüchen und Leerzeilen an Absatzgrenzen. */
  text: string
  /** false, wenn keine Schriftinformationen vorliegen (z. B. nach OCR). */
  hasFontInfo: boolean
}

export const EMPTY_DOCUMENT_TEXT: DocumentText = { lines: [], text: '', hasFontInfo: false }

/** Baut den Volltext aus den Zeilen (inkl. Leerzeilen an Absatzgrenzen). */
export function linesToText(lines: TextLine[]): string {
  const out: string[] = []
  for (const line of lines) {
    if (line.paragraphBreak && out.length > 0) out.push('')
    out.push(line.text)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Erzeugt eine DocumentText-Struktur aus reinem Text (z. B. OCR-Ergebnis). */
export function documentTextFromPlainText(text: string): DocumentText {
  const lines: TextLine[] = text.split(/\r?\n/).map((raw) => ({
    y: 0,
    segments: raw.trim() ? [{ text: raw.trim(), x: 0, endX: 0, bold: false, size: 0 }] : [],
    text: raw.trim(),
    paragraphBreak: false,
  }))
  return { lines, text: text.trim(), hasFontInfo: false }
}

export function mergeDocumentTexts(parts: DocumentText[]): DocumentText {
  const lines = parts.flatMap((p) => p.lines)
  return {
    lines,
    text: parts.map((p) => p.text).filter(Boolean).join('\n'),
    hasFontInfo: parts.some((p) => p.hasFontInfo),
  }
}

/* ------------------------------------------------------------- Hilfsfunktionen */

const INTEGER_ONLY = /^[0-9]{1,4}$/

/** Reine Ganzzahl im Fettdruck (Kandidat für eine Positionsnummer). */
export function isBoldInteger(segment: TextSegment): boolean {
  return segment.bold && INTEGER_ONLY.test(segment.text.trim())
}

/** Alle fett gesetzten Fragmente einer Zeile. */
export function boldSegments(line: TextLine): TextSegment[] {
  return line.segments.filter((s) => s.bold && s.text.trim().length > 0)
}

/** Text der Fragmente rechts von einer x-Position. */
export function textRightOf(line: TextLine, x: number): string {
  return line.segments
    .filter((s) => s.x > x)
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
