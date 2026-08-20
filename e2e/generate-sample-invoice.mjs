import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const lines = [
  'Musterfirma GmbH',
  'Beispielweg 3',
  '1234 Beispielstadt',
  '',
  'Empfaenger Kunde AG',
  'Rue de la Paix 5',
  '1000 Bruessel',
  'Belgien',
  '',
  'Lieferadresse:',
  'Kunde Filiale',
  'Handelskaai 12',
  '1000 Bruessel',
  'Belgien',
  '',
  'Rechnungsnummer: 2026-08-0001',
  'Rechnungsdatum: 05.08.2026',
  'Vom: 01.08.2026 Bis: 31.08.2026',
  'Ihre USt-IdNr.: BE0123456789',
  '',
  'Position 1',
  'Produktbezeichnung: DPZ Hobby 1.0L',
  'Menge: 500',
  'Zolltarif-Nr.: 39235000',
  'Betrag: 1.250,00 EUR',
  '',
  'Netto-Gesamtgewicht: 165 kg',
  'Warenwert gesamt: 1.250,00 EUR',
]

const doc = await PDFDocument.create()
const page = doc.addPage([595, 842])
const font = await doc.embedFont(StandardFonts.Helvetica)
let y = 800
for (const line of lines) {
  page.drawText(line, { x: 50, y, size: 11, font })
  y -= 16
}
const bytes = await doc.save()
writeFileSync(new URL('./fixtures/sample-invoice.pdf', import.meta.url), bytes)
console.log('written')
