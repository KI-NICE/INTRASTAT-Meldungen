import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

/**
 * Erzeugt synthetische Beispielrechnungen im Layout der echten Rechnungen
 * (keine echten Kunden- oder Rechnungsdaten):
 *
 *  - Rechnungsnummer oben rechts FETT neben "RECHNUNG"/"INVOICE"
 *  - Rechnungsdatum in "vom:"/"dated:" plus irreführendes Auftragsdatum
 *  - Positionsnummern linksbündig FETT ("10", "20")
 *  - Mengen FETT; Preise stehen "per 100" und dürfen nicht als Menge gelten
 *  - ein Flaschenartikel mit Gewicht in der Beschreibung ("Gew.:20 g")
 */

const X_POS = 50
const X_DESC = 90
const X_QTY = 250
const X_PRICE = 350
const X_AMOUNT = 450

// [Text, x, fett?]
const GERMAN = [
  [['Muster Verpackung GmbH', X_POS], ['RECHNUNG', 380, true], ['4711-2026', 470, true]],
  [['Industriestr. 1', X_POS]],
  [['D-70173 Stuttgart', X_POS], ['vom: 05.08.2026', 380]],
  [['Ihr Auftrag vom: 15.07.2026', 380]],
  'BLANK',
  [['Beispiel Kunde AG', X_POS]],
  [['Rue de la Paix 5', X_POS]],
  [['B-1000 Bruessel', X_POS]],
  'BLANK',
  [['Auftragsadresse:', X_POS]],
  [['Beispiel Kunde AG', X_POS]],
  [['Rue de la Paix 5', X_POS]],
  [['B-1000 Bruessel', X_POS]],
  'BLANK',
  [['Lieferadresse:', X_POS]],
  [['Beispiel Kunde Werk Nord', X_POS]],
  [['Handelskaai 12', X_POS]],
  [['A-1010 Wien', X_POS]],
  'BLANK',
  [['Ihre USt-IdNr.: BE 0123456789', X_POS]],
  'BLANK',
  [['Pos', X_POS], ['Bezeichnung', X_DESC], ['Menge', X_QTY], ['Preis/100', X_PRICE], ['Betrag', X_AMOUNT]],
  [['10', X_POS, true], ['Sprayer K2 rot mit Kappe 28/410', X_DESC]],
  [['1000 Stueck', X_QTY, true], ['12,50', X_PRICE], ['125,00', X_AMOUNT]],
  [['Zolltarif-Nr.: 39235000', X_DESC]],
  [['20', X_POS, true], ['Zyl.Flasche 250 ml natur Gew.:20 g', X_DESC]],
  [['252 Stueck', X_QTY, true], ['30,00', X_PRICE], ['75,60', X_AMOUNT]],
  [['Zolltarif-Nr..: 39233010', X_DESC]],
  'BLANK',
  [['**************************************************', X_POS]],
  [['Net weight: 56,00 kg', X_POS]],
]

const ENGLISH = [
  [['Muster Verpackung GmbH', X_POS], ['INVOICE', 380, true], ['4712-2026', 470, true]],
  [['D-70173 Stuttgart', X_POS], ['dated: 12.08.2026', 380]],
  [['your order dated: 10.07.2026', 380]],
  'BLANK',
  [['Delivery address:', X_POS]],
  [['Example Customer Ltd', X_POS]],
  [['Handelskaai 12', X_POS]],
  [['B-2000 Antwerpen', X_POS]],
  'BLANK',
  [['Your VAT-ID: BE 0987654321', X_POS]],
  'BLANK',
  [['Pos', X_POS], ['Description', X_DESC], ['Quantity', X_QTY], ['Price/100', X_PRICE], ['Dly.date', X_AMOUNT]],
  [['10', X_POS, true], ['Sprayer K3 blue', X_DESC]],
  [['200 pcs', X_QTY, true], ['10,00', X_PRICE], ['20,00', X_AMOUNT]],
  [['Customs tariff no.: 39235000', X_DESC]],
  'BLANK',
  [['**************************************************', X_POS]],
  [['Net weight: 7,00 kg', X_POS]],
]

async function writeInvoice(spec, fileName) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let y = 800
  const lineHeight = 14

  for (const line of spec) {
    if (line === 'BLANK') {
      y -= lineHeight * 1.6
      continue
    }
    for (const [text, x, isBold] of line) {
      page.drawText(text, { x, y, size: 10, font: isBold ? bold : regular })
    }
    y -= lineHeight
  }

  const bytes = await doc.save()
  writeFileSync(new URL(`./fixtures/${fileName}`, import.meta.url), bytes)
  console.log(`${fileName} geschrieben`)
}

await writeInvoice(GERMAN, 'rechnung-de.pdf')
await writeInvoice(ENGLISH, 'rechnung-en.pdf')
