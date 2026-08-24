/**
 * Lokaler Proxy-Server, über den Claude Rechnungs-PDFs liest.
 *
 * Zweck: Der Anthropic-API-Key bleibt ausschließlich auf dem Server. Die
 * Web-App kennt ihn nicht und kann ihn nicht preisgeben – anders als bei einem
 * Aufruf direkt aus dem Browser, bei dem der Key im JavaScript-Bundle landen
 * und von jedem gelesen werden könnte.
 *
 * Der Server liefert zusätzlich den gebauten `dist`-Ordner aus, sodass ein
 * einziger Befehl genügt:
 *
 *   npm run build && npm run server      (oder: npm start)
 *
 * WICHTIG: Claude ist die einzige Quelle der Rechnungsdaten – es gibt keine
 * eigene, deterministische PDF-Auswertung mehr. Ohne Key bzw. ohne
 * erreichbaren Proxy ist die App nicht funktionsfähig; jede Rechnung wird
 * vollständig an die Anthropic-API übertragen.
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const distDir = join(projectRoot, 'dist')

/* --------------------------------------------------------------- .env lesen */

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const result = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

const fileEnv = loadEnvFile(join(projectRoot, '.env'))
const env = { ...fileEnv, ...process.env }

const API_KEY = env.ANTHROPIC_API_KEY ?? ''
const CONFIGURED_MODEL = env.ANTHROPIC_MODEL ?? ''
const PORT = Number(env.PORT ?? 8787)
const API_BASE = env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
const MAX_BODY_BYTES = 32 * 1024 * 1024

/* ------------------------------------------------------------ Modellauswahl */

let resolvedModel = null
let modelResolutionError = null

/**
 * Ermittelt das zu verwendende Modell. Ist in der .env keines gesetzt, wird
 * die Modell-Liste des Kontos abgefragt und das neueste Sonnet-Modell
 * gewählt. So bleibt die Konfiguration auch dann gültig, wenn sich
 * Modellnamen ändern.
 */
async function resolveModel() {
  if (resolvedModel) return resolvedModel
  if (CONFIGURED_MODEL) {
    resolvedModel = CONFIGURED_MODEL
    return resolvedModel
  }

  const response = await fetch(`${API_BASE}/v1/models?limit=50`, {
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
  })
  if (!response.ok) {
    modelResolutionError = `Modell-Liste konnte nicht geladen werden (HTTP ${response.status}). Bitte ANTHROPIC_MODEL in der .env setzen.`
    throw new Error(modelResolutionError)
  }
  const body = await response.json()
  const ids = (body.data ?? []).map((m) => m.id)
  resolvedModel =
    ids.find((id) => /sonnet/i.test(id)) ?? ids.find((id) => /opus/i.test(id)) ?? ids[0]
  if (!resolvedModel) {
    modelResolutionError = 'Es wurde kein verwendbares Modell gefunden. Bitte ANTHROPIC_MODEL setzen.'
    throw new Error(modelResolutionError)
  }
  return resolvedModel
}

/* ----------------------------------------------------- Werkzeug-Definition */

const RESULT_TOOL = {
  name: 'rechnungsdaten',
  description:
    'Gibt die aus der Rechnung gelesenen Felder strukturiert zurück. Diese Felder sind die alleinige Grundlage der Intrastat-Meldung. Nicht eindeutig lesbare Felder werden auf null gesetzt.',
  input_schema: {
    type: 'object',
    properties: {
      language: { type: ['string', 'null'], enum: ['de', 'en', null], description: 'Sprache der Rechnung' },
      invoiceNumber: { type: ['string', 'null'], description: 'Rechnungsnummer, fett neben "RECHNUNG"/"INVOICE"' },
      invoiceDate: {
        type: ['string', 'null'],
        description: 'Rechnungsdatum aus dem Feld "vom:" bzw. "dated:" im Format TT.MM.JJJJ. NICHT das Datum aus "Ihr Auftrag vom:"/"your order dated:".',
      },
      vatId: { type: ['string', 'null'], description: 'USt-IdNr. des Warenempfängers ohne Leerzeichen' },
      destinationCountryCode: {
        type: ['string', 'null'],
        description:
          'Zweistelliger ISO-3166-1-Alpha-2-Code des Bestimmungslandes, abgeleitet aus dem Länderkennzeichen vor der Postleitzahl der Lieferadresse (ersatzweise Auftragsadresse). Beispiele: A→AT, B→BE, D→DE, F→FR, I→IT, E→ES, L→LU, S→SE, H→HU, P→PT, SLO→SI.',
      },
      destinationAddressUsed: {
        type: ['string', 'null'],
        enum: ['lieferadresse', 'auftragsadresse', 'empfaengeradresse', 'versandanschrift', null],
        description: 'Welche Adresse für das Bestimmungsland verwendet wurde',
      },
      destinationAddressText: {
        type: ['string', 'null'],
        description:
          'Die für das Bestimmungsland verwendete Adresse als vollständiger Text (Zeilen durch "\\n" getrennt), damit manuelle Korrekturen adressgenau gespeichert werden können.',
      },
      netWeightTotalKg: {
        type: ['number', 'null'],
        description:
          'Netto-Gesamtgewicht in kg. Suche sinngemäß im gesamten Dokument danach – die Beschriftung variiert stark, u. a. "Netto:", "Nettogewicht", "NET", "Net.", "Net Weight", "Net Wt.", "N.W." (unabhängig von Groß-/Kleinschreibung, Abkürzung oder ob ein Doppelpunkt folgt). Meist in der Fußzeile (oft hinter einer Sternchen-Trennlinie), das ist aber keine Voraussetzung. Verwechsle es NIEMALS mit einem Brutto-Gewicht ("Brutto", "Gross Weight", "Peso lordo") oder einem Geldbetrag in EUR.',
      },
      freightCostEur: { type: ['number', 'null'], description: 'Ausgewiesene Frachtkosten in EUR, sonst null' },
      versendungsmitgliedstaatCode: {
        type: ['string', 'null'],
        description:
          'Nur bei Eingangsrechnungen: zweistelliger ISO-3166-1-Alpha-2-Code des Landes, aus dem die Ware tatsächlich versendet wurde (Lieferantenadresse/Versandort). Bei Ausgangsrechnungen immer null.',
      },
      ursprungslandCode: {
        type: ['string', 'null'],
        description:
          'Nur bei Eingangsrechnungen: zweistelliger ISO-3166-1-Alpha-2-Code des tatsächlichen Ursprungslandes der Ware (kann vom Versandland abweichen), sofern erkennbar. Sonst null.',
      },
      positions: {
        type: 'array',
        description: 'Alle Rechnungspositionen in der Reihenfolge der Rechnung',
        items: {
          type: 'object',
          properties: {
            positionNumber: { type: ['string', 'null'], description: 'Positionsnummer, linksbündig fett (z. B. "10", "20")' },
            productDescription: { type: ['string', 'null'], description: 'Vollständige Artikelbezeichnung rechts der Positionsnummer' },
            customsCode: {
              type: ['string', 'null'],
              description:
                'Warennummer aus "Zolltarif-Nr.:" bzw. "Customs tariff no.:", nur Ziffern. Die Warennummer ist IMMER genau 8-stellig – lies alle Ziffern sorgfältig und vollständig ab, insbesondere führende Nullen (z. B. "03926000"), die leicht übersehen werden. Gib den Wert exakt wie auf der Rechnung abgedruckt zurück, auch wenn er ausnahmsweise nicht 8-stellig erscheinen sollte – erfinde und kürze keine Ziffern.',
            },
            quantity: {
              type: ['number', 'null'],
              description: 'Stückzahl aus der FETT gesetzten Zahl (z. B. "1000 Stück"). Achtung: Preise sind "per 100" angegeben und sind NICHT die Menge.',
            },
            amountEur: { type: ['number', 'null'], description: 'Positionsbetrag aus der Betragsspalte in EUR' },
            weightPerPieceGrams: {
              type: ['number', 'null'],
              description:
                'Nur wenn das Artikelgewicht in der Produktbeschreibung steht (Flaschenartikel wie "Zyl.", "Zylinderflasche", "Zylk.", "FL", "VK", "Vierkant" mit Angabe "Gew.:20 g"): Gewicht je Stück in Gramm. Sonst null.',
            },
            isCreditOrDiscount: {
              type: ['boolean', 'null'],
              description: 'true bei Gutschrift, Storno, Rabatt oder negativem Betrag',
            },
            articleNumber: {
              type: ['string', 'null'],
              description:
                'Fett gesetzte Artikelnummer unter der Spaltenüberschrift "Artikelangaben" bzw. "Part description" (bei ausländischen Eingangsrechnungen z. B. auch "Your Code"/"Your Ref."), über der eigentlichen Artikelbezeichnung. Gib sie für JEDE Position an, bei der eine solche Nummer erkennbar ist (nicht nur für Frachtkosten-Positionen wie "090025") – sie identifiziert den Artikel eindeutig und unabhängig von Schreibweise-Varianten der Bezeichnung. Sonst null.',
            },
          },
          required: ['positionNumber', 'productDescription', 'customsCode', 'quantity', 'amountEur'],
        },
      },
      uncertainFields: {
        type: 'array',
        description: 'Bezeichnungen der Felder, bei denen die Lesung unsicher ist',
        items: { type: 'string' },
      },
    },
    required: ['positions'],
  },
}

const SYSTEM_PROMPT_BASE = `Du liest Rechnungen (Ausgangs- oder Eingangsrechnungen) für eine Intrastat-Meldung vollständig und verbindlich aus. Deine Angaben sind die alleinige Grundlage der Meldung – es gibt keine weitere Prüfung.

Verbindliche Regeln:
- Lies ausschließlich, was in der Rechnung steht. Rate nichts. Ist ein Wert nicht eindeutig lesbar, setze ihn auf null und nenne das Feld in "uncertainFields".
- Das Rechnungsdatum steht im Feld "vom:" (deutsch) bzw. "dated:" (englisch) direkt unter bzw. neben der Rechnungsnummer. Das Datum aus "Ihr Auftrag vom:", "your order dated:", "Bestellung vom:" oder "Lieferschein vom:" ist NICHT das Rechnungsdatum.
- Die Rechnungsnummer steht oben rechts fett neben der Überschrift "RECHNUNG" bzw. "INVOICE".
- Jede Position beginnt mit einer linksbündigen, fett gesetzten Positionsnummer ("10", "20", ...). Rechts davon beginnt die Artikelbezeichnung.
- Die Menge ist ausschließlich die fett gesetzte Stückzahl. Preise sind "per 100" angegeben und dürfen nie als Menge gelesen werden.
- Das Netto-Gesamtgewicht muss SINNGEMÄSS im gesamten Dokument gesucht werden – die Beschriftung ist von Rechnung zu Rechnung unterschiedlich, u. a. "Netto:", "Nettogewicht", "NET", "Net.", "Net Weight", "Net Wt.", "N.W." (unabhängig von Groß-/Kleinschreibung, Abkürzung oder ob ein Doppelpunkt folgt). Meist steht es in der Fußzeile (oft hinter einer Sternchen-Trennlinie), das ist aber keine Voraussetzung – suche notfalls auf der GESAMTEN Seite danach. Ein Netto-GELDBETRAG in EUR oder ein Brutto-Gewicht ("Brutto", "Gross Weight", "Peso lordo") ist NICHT das gesuchte Gewicht.
- Das Bestimmungsland ergibt sich aus dem Länderkennzeichen vor der Postleitzahl der Lieferadresse, ersatzweise der Auftragsadresse. Wandle es in den ISO-3166-1-Alpha-2-Code um (A→AT, B→BE, D→DE, F→FR, I→IT, E→ES, L→LU, S→SE, H→HU, P→PT, SLO→SI, NL→NL, ...). Gib zusätzlich die verwendete Adresse vollständig als Text zurück ("destinationAddressText").
- Steht bei Flaschenartikeln ("Zyl.", "Zylinderflasche", "Zylk.", "FL", "VK", "Vierkant") ein Gewicht in der Produktbeschreibung (z. B. "Gew.:20 g"), gib es als weightPerPieceGrams an. Sonst null.
- Steht unter der Spaltenüberschrift "Artikelangaben" bzw. "Part description" eine fett gesetzte Artikelnummer über der Artikelbezeichnung, gib sie als "articleNumber" der Position an – bei JEDER Position, nicht nur bei Frachtkosten-Positionen (z. B. "090025"). Sonst null.`

const SYSTEM_PROMPT_AUSGANG_EXTRA = `
- Diese Rechnung ist eine AUSGANGSRECHNUNG. Oben links auf der Rechnung steht fett die Überschrift "Rechnungsempfänger" (bzw. "Invoice recipient"/"Bill to") mit der Kundenadresse darunter. DIES ist die für das Bestimmungsland maßgebliche Adresse ("destinationAddressUsed": "empfaengeradresse") – bevorzuge sie gegenüber der Lieferadresse und der Auftragsadresse. Weiche nur dann auf die Lieferadresse bzw. ersatzweise die Auftragsadresse aus, wenn unter "Rechnungsempfänger" keine eindeutige Adresse mit Länderkennzeichen erkennbar ist.
- Manche Ausgangsrechnungen enthalten zusätzlich eine eigens beschriftete "Versandanschrift" (bzw. "Shipping address"/"Ship to"). Ist eine solche Überschrift vorhanden, ist die DARUNTER stehende Adresse die tatsächliche Empfangsadresse und für das Bestimmungsland maßgeblich ("destinationAddressUsed": "versandanschrift") – sie hat dann VORRANG vor der Adresse im Briefkopf oben auf der Rechnung sowie vor "Rechnungsempfänger", "Lieferadresse" und "Auftragsadresse". Die Adresse im Briefkopf ist in diesem Fall lediglich die Rechnungsadresse und NICHT für das Bestimmungsland relevant.
- Das Netto-Gesamtgewicht steht bei Ausgangsrechnungen fast immer relativ weit unten in der Fußzeile, typischerweise HINTER einer langen Trennlinie aus Sternchen (z. B. "**************************************************") gefolgt von "Netto:" und dem Gewichtswert. Suche GEZIELT und AKRIBISCH nach genau diesem Muster (Sternchen-Trennlinie, dann "Netto:") ganz unten auf der Seite, bevor du das Feld als unsicher/null meldest – dieser Wert wird sonst leicht übersehen, weil er weit vom eigentlichen Rechnungskopf entfernt steht.`

const SYSTEM_PROMPT_EINGANG_EXTRA = `
- Diese Rechnung ist eine EINGANGSRECHNUNG. Lies zusätzlich, sofern auf der Rechnung erkennbar:
  - "versendungsmitgliedstaatCode": ISO-3166-1-Alpha-2-Code des Landes, aus dem die Ware tatsächlich versendet wurde (Absender-/Lieferantenadresse, Versandort).
  - "ursprungslandCode": ISO-3166-1-Alpha-2-Code des tatsächlichen Ursprungslandes der Ware (kann vom Versandland abweichen, z. B. bei Reexport).
  Ist einer dieser Werte auf der Rechnung nicht eindeutig erkennbar, setze ihn auf null und nenne das Feld in "uncertainFields" – er wird dann in der Prüfansicht manuell nachgetragen.
- Das Netto-Gesamtgewicht ("netWeightTotalKg") kann bei Eingangsrechnungen an einer beliebigen Stelle im Dokument stehen (Kopf, Fußzeile, als Summenzeile der Positionstabelle o. ä.) und uneinheitlich beschriftet sein. Es kann auch HANDSCHRIFTLICH ergänzt worden sein (z. B. als handschriftliche Notiz oder Korrektur am Rand, über oder neben einem gedruckten Wert) – durchsuche das gesamte Dokument sinngemäß auch nach solchen handschriftlichen Vermerken, nicht nur nach gedrucktem Text. Analysiere das gesamte Dokument sinngemäß und verwende den wahrscheinlichsten Kandidaten (eine erkennbare handschriftliche Korrektur hat dabei Vorrang vor einem durchgestrichenen oder abweichenden gedruckten Wert). Gibt es mehrere mögliche Zahlen und ist nicht eindeutig erkennbar, welche das tatsächliche Netto-Gesamtgewicht ist, oder findet sich gar kein plausibler Kandidat, setze den Wert auf null (für die manuelle Nacherfassung) – rate NICHT.
- Eingangsrechnungen stammen von unterschiedlichsten Lieferanten und können in JEDER Sprache verfasst sein, überwiegend Deutsch, Englisch oder Italienisch, aber auch andere. Verlasse dich NIE auf eine einzelne erwartete Sprache oder ein festes Layout. Erkenne die relevanten Positions-Spalten anhand ihrer BEDEUTUNG, unabhängig von der genauen Bezeichnung auf der Rechnung – u. a. anhand dieser sprachübergreifenden Synonyme:
  - Menge/Stückzahl: "Menge", "Anzahl", "Stück" (DE) · "Quantity", "Qty", "Q.TY", "Amount" (wenn eindeutig eine Stückzahl und kein Geldbetrag) (EN) · "Quantità", "Q.tà", "Pezzi" (IT)
  - Artikelbezeichnung: "Artikel", "Bezeichnung", "Warenbezeichnung" (DE) · "Description", "Item", "Product", "Goods" (EN) · "Descrizione", "Articolo" (IT)
  - Warennummer/Zolltarifnummer: "Zolltarif-Nr.", "Warennummer", "HS-Code" (DE) · "Customs tariff no.", "HS code", "Commodity code", "Tariff no." (EN) · "Codice doganale", "Voce doganale", "Codice HS" (IT)
  - Artikelnummer ("articleNumber"): "Artikelangaben", "Artikel-Nr." (DE) · "Part description", "Part no.", "Your Code", "Your Ref." (EN) · "Codice articolo", "Cod. art." (IT)
  - Positionsbetrag: "Betrag", "Gesamtpreis", "Summe" (DE) · "Amount", "Total", "Net amount" (EN) · "Importo", "Totale", "Prezzo totale" (IT)
  - Rechnungsdatum: "Rechnungsdatum", "vom" (DE) · "Invoice date", "Date", "Dated" (EN) · "Data fattura", "Data" (IT)
  Ist eine Spaltenüberschrift in einer anderen Sprache oder ungewohnt beschriftet, ordne sie anhand von Kontext (Position in der Tabelle, Zahlenformat, übliche Reihenfolge Menge → Beschreibung → Preis) der richtigen Bedeutung zu, statt das Feld null zu lassen.`

const SYSTEM_PROMPT_FOOTER = `

Gib das Ergebnis ausschließlich über das Werkzeug "rechnungsdaten" zurück.`

function buildSystemPrompt(richtung) {
  const extra = richtung === 'E' ? SYSTEM_PROMPT_EINGANG_EXTRA : SYSTEM_PROMPT_AUSGANG_EXTRA
  return SYSTEM_PROMPT_BASE + extra + SYSTEM_PROMPT_FOOTER
}

/* ---------------------------------------------------------- API-Aufruf */

async function callAnthropic(pdfBase64, fileName, richtung) {
  const model = await resolveModel()

  const payload = {
    model,
    max_tokens: 8000,
    system: buildSystemPrompt(richtung),
    tools: [RESULT_TOOL],
    tool_choice: { type: 'tool', name: RESULT_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          {
            type: 'text',
            text: `Lies die Felder dieser Rechnung (${fileName}) gemäß den Regeln aus.`,
          },
        ],
      },
    ],
  }

  async function send(withPdfBeta) {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    }
    if (withPdfBeta) headers['anthropic-beta'] = 'pdfs-2024-09-25'
    return fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  }

  // Erst mit PDF-Beta-Header, bei einem darauf bezogenen Fehler ohne.
  let response = await send(true)
  if (!response.ok) {
    const text = await response.text()
    if (/beta/i.test(text)) {
      response = await send(false)
      if (!response.ok) {
        throw new Error(`Anthropic-API-Fehler (HTTP ${response.status}): ${await response.text()}`)
      }
    } else {
      throw new Error(`Anthropic-API-Fehler (HTTP ${response.status}): ${text}`)
    }
  }

  const body = await response.json()
  const toolUse = (body.content ?? []).find((block) => block.type === 'tool_use')
  if (!toolUse) {
    throw new Error('Die Antwort enthielt keine strukturierten Rechnungsdaten.')
  }

  return { model, fields: toolUse.input, usage: body.usage ?? null }
}

/* --------------------------------------------------------- HTTP-Hilfsmittel */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function applyCors(req, res) {
  const origin = req.headers.origin
  // Nur lokale Entwicklungsserver dürfen zugreifen.
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Die Datei ist zu groß für die Prüfung.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function serveStatic(req, res, urlPath) {
  let relative = decodeURIComponent(urlPath)
  if (relative === '/' || relative === '') relative = '/index.html'

  const target = normalize(join(distDir, relative))
  if (!target.startsWith(distDir)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  let filePath = target
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    filePath = join(distDir, 'index.html')
  }

  try {
    const content = await readFile(filePath)
    res.writeHead(200, {
      'content-type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'content-length': content.length,
    })
    res.end(content)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Nicht gefunden. Wurde die App gebaut? (npm run build)')
  }
}

/* -------------------------------------------------------------------- Server */

const server = createServer(async (req, res) => {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (url.pathname === '/api/health') {
    sendJson(res, 200, {
      available: API_KEY.length > 0,
      model: resolvedModel ?? CONFIGURED_MODEL ?? null,
      hinweis: API_KEY.length > 0
        ? 'Claude verfügbar. Vollständige Rechnungs-PDFs werden zum Auslesen an die Anthropic-API übertragen.'
        : 'Kein ANTHROPIC_API_KEY gesetzt – ohne Claude ist die App nicht funktionsfähig.',
    })
    return
  }

  if (url.pathname === '/api/verify' && req.method === 'POST') {
    if (!API_KEY) {
      sendJson(res, 503, { error: 'Kein ANTHROPIC_API_KEY gesetzt. Bitte in der .env hinterlegen.' })
      return
    }
    try {
      const raw = await readBody(req)
      const { fileName, pdfBase64, richtung } = JSON.parse(raw.toString('utf8'))
      if (!pdfBase64) {
        sendJson(res, 400, { error: 'Es wurde keine PDF übermittelt.' })
        return
      }
      const result = await callAnthropic(pdfBase64, fileName ?? 'Rechnung.pdf', richtung)
      sendJson(res, 200, result)
    } catch (error) {
      console.error('[verify]', error)
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'Unbekannter Fehler' })
    }
    return
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Unbekannter Endpunkt' })
    return
  }

  await serveStatic(req, res, url.pathname)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Intrastat-App: http://localhost:${PORT}`)
  console.log(
    API_KEY
      ? 'Claude-Anbindung: aktiv (Rechnungs-PDFs werden zum Auslesen an die Anthropic-API übertragen)'
      : 'Claude-Anbindung: inaktiv (kein ANTHROPIC_API_KEY in der .env) – die App ist ohne Claude nicht funktionsfähig',
  )
  if (!existsSync(distDir)) {
    console.log('Hinweis: Der Ordner dist/ fehlt. Bitte zuerst "npm run build" ausführen.')
  }
  if (modelResolutionError) console.log(modelResolutionError)
})
