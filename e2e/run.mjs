import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fx = (name) => path.join(here, 'fixtures', name)

const downloadDir = path.join(here, 'downloads')
fs.mkdirSync(downloadDir, { recursive: true })

const executablePath = process.env.CHROMIUM_PATH || undefined

const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console error]', msg.text())
})
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

const baseUrl = process.env.APP_URL || 'http://localhost:4173/'
await page.goto(baseUrl)

// Claude ist die einzige Quelle der Rechnungsdaten – ohne erreichbaren Proxy
// (echt oder per mock-anthropic.mjs nachgebildet) zeigt die App nur den
// Blockbildschirm und der Test bricht hier sichtbar ab.
await page.waitForSelector('.bundled-info, .ai-blocked', { timeout: 15000 })
if (await page.locator('.ai-blocked').count() > 0) {
  console.log('--- KEINE VERBINDUNG ZU CLAUDE ---')
  console.log(await page.locator('.ai-blocked').innerText())
  await browser.close()
  process.exit(1)
}

console.log('--- HINTERLEGTE GRUNDDATEN ---')
await page.waitForTimeout(300)
console.log(await page.locator('.bundled-info').innerText())

// Schritt 1: Bezugsmonat (Standard 08/2026 passt zur Beispielrechnung)
await page.getByRole('button', { name: 'Weiter' }).click()

// Schritt 2: Rechnungen hochladen
await page.locator('input[type=file]').last().setInputFiles([fx('rechnung-de.pdf'), fx('rechnung-en.pdf')])
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Weiter' }).click()

// Schritt 3: Analyse (Claude liest beide Rechnungen aus)
await page.getByRole('button', { name: 'Analyse starten' }).click()
await page.waitForSelector('text=4. Fehler und offene Zuordnungen bearbeiten', { timeout: 60000 })
await page.waitForTimeout(500)

console.log('--- PRUEFANSICHT: RECHNUNGSKOPF ---')
for (const meta of await page.locator('.invoice-meta').all()) console.log(await meta.innerText(), '\n---')

console.log('--- PRUEFANSICHT: POSITIONEN ---')
for (const t of await page.locator('.review-table').all()) console.log(await t.innerText(), '\n---')

const aiPanels = await page.locator('.ai-panel').all()
if (aiPanels.length > 0) {
  console.log('--- VON CLAUDE ALS UNSICHER GEMELDET / FEHLER ---')
  for (const panel of aiPanels) console.log(await panel.innerText(), '\n---')
}

const issues = await page.locator('.invoice-card .issue').allInnerTexts()
console.log('--- OFFENE MELDUNGEN ---')
console.log(issues.length === 0 ? '(keine)' : issues.join('\n'))

await page.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
await page.waitForSelector('text=5. Vorschau der Intrastat-Daten')
console.log('--- VORSCHAU (Spalten A-P) ---')
console.log(await page.locator('.review-table').first().innerText())

await page.getByRole('button', { name: 'Weiter zum Export' }).click()
await page.waitForSelector('text=6. Excel-Datei exportieren')
console.log('--- EXPORT-ZUSAMMENFASSUNG ---')
console.log(await page.locator('.export-summary').innerText())

const downloadButton = page.getByRole('button', { name: /herunterladen/ })
const isDisabled = await downloadButton.isDisabled()
console.log('Download-Button gesperrt:', isDisabled)

if (!isDisabled) {
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()])
  const savePath = path.join(downloadDir, await download.suggestedFilename())
  await download.saveAs(savePath)
  console.log('HERUNTERGELADEN:', savePath)
} else {
  console.log('Export blockiert – siehe offene Meldungen oben.')
}

await browser.close()
