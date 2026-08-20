import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

/**
 * Erzeugt eine synthetische Beispielrechnung im Layout der echten Rechnungen
 * (keine echten Kunden-/Rechnungsdaten). Absatzabstände werden über groessere
 * y-Sprünge dargestellt, damit die Adressblöcke sauber getrennt sind.
 */

// [Text, Extra-Abstand davor]
const blocks = [
  ['Muster Verpackung GmbH', 0],
  ['Industriestr. 1', 0],
  ['D-70173 Stuttgart', 0],

  ['Beispiel Kunde AG', 1],
  ['Rue de la Paix 5', 0],
  ['B-1000 Bruessel', 0],

  ['Auftragsadresse:', 1],
  ['Beispiel Kunde AG', 0],
  ['Rue de la Paix 5', 0],
  ['B-1000 Bruessel', 0],

  ['Lieferadresse:', 1],
  ['Beispiel Kunde Werk Nord', 0],
  ['Handelskaai 12', 0],
  ['A-1010 Wien', 0],

  ['Rechnungsnummer: 2026-08-0001', 1],
  ['vom: 05.08.2026', 0],
  ['Ihr Auftrag vom: 15.07.2026', 0],
  ['Ihre USt-IdNr.: BE 0123456789', 0],

  ['Pos   Menge          Bezeichnung                Einzelpreis      Betrag', 1],
  ['1', 1],
  ['500,00 Stueck', 0],
  ['Sprayer K2 rot mit Kappe 28/410', 0],
  ['2,50                 1.250,00', 0],
  ['Zolltarif-Nr.: 39235000', 0],

  ['2', 1],
  ['1.000,00 Stueck', 0],
  ['Sicherheitsverschluss weiss', 0],
  ['0,45                   450,00', 0],
  ['Zolltarif-Nr..: 39233010', 0],

  ['**************************************************', 1],
  ['Net weight: 32,00 kg', 0],
]

const doc = await PDFDocument.create()
const page = doc.addPage([595, 842])
const font = await doc.embedFont(StandardFonts.Helvetica)

let y = 800
const lineHeight = 14
for (const [text, gapBefore] of blocks) {
  y -= gapBefore * lineHeight * 1.6
  page.drawText(text, { x: 50, y, size: 10, font })
  y -= lineHeight
}

const bytes = await doc.save()
writeFileSync(new URL('./fixtures/sample-invoice.pdf', import.meta.url), bytes)
console.log('sample-invoice.pdf geschrieben')
