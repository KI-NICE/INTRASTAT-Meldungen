import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fx = (name) => path.join(here, 'fixtures', name)

const downloadDir = path.join(here, 'downloads')
fs.mkdirSync(downloadDir, { recursive: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage()
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

await page.goto('http://localhost:4173/')

// Step 1: Mustertabelle
await page.locator('input[type=file]').first().setInputFiles(fx('Mustertabelle.xlsx'))
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Weiter' }).click()

// Step 2: Gewichtsliste
await page.locator('input[type=file]').first().setInputFiles(fx('Gewichtsliste.docx'))
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Weiter' }).click()

// Step 3: Bezugsmonat (Default 08/2026 passt zur Beispielrechnung)
await page.getByRole('button', { name: 'Weiter' }).click()

// Step 4: Rechnungen
await page.locator('input[type=file]').first().setInputFiles(fx('sample-invoice.pdf'))
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Weiter' }).click()

// Step 5: Analyse
await page.getByRole('button', { name: 'Analyse starten' }).click()
await page.waitForSelector('text=6. Fehler und offene Zuordnungen bearbeiten', { timeout: 30000 })
await page.waitForTimeout(500)

const reviewHtml = await page.locator('.review-table-wrapper').innerHTML()
console.log('--- REVIEW TABLE STATUS SNIPPET ---')
console.log(reviewHtml.includes('badge--ok') ? 'STATUS: ok badge present' : 'STATUS: no ok badge')
console.log(reviewHtml.includes('badge--error') ? 'STATUS: error badge present' : 'STATUS: no error badge')

// Vollständigen Text der Prüfansicht für Diagnose ausgeben
const bodyText = await page.locator('.review-table-wrapper').innerText()
console.log('--- REVIEW TABLE TEXT ---')
console.log(bodyText)

await page.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
await page.waitForSelector('text=7. Vorschau der Intrastat-Daten')
const previewText = await page.locator('.review-table-wrapper').innerText()
console.log('--- PREVIEW TABLE TEXT ---')
console.log(previewText)

await page.getByRole('button', { name: 'Weiter zum Export' }).click()
await page.waitForSelector('text=8. Excel-Datei exportieren')

const summaryText = await page.locator('.export-summary').innerText()
console.log('--- EXPORT SUMMARY ---')
console.log(summaryText)

const downloadButton = page.getByRole('button', { name: /herunterladen/ })
const isDisabled = await downloadButton.isDisabled()
console.log('Download button disabled:', isDisabled)

if (!isDisabled) {
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()])
  const savePath = path.join(downloadDir, await download.suggestedFilename())
  await download.saveAs(savePath)
  console.log('DOWNLOADED TO', savePath)
} else {
  console.log('Export blockiert - siehe offene Fehler oben.')
}

await browser.close()
