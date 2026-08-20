/**
 * Nachbildung der Anthropic-API für den End-to-End-Test.
 *
 * Erlaubt es, den kompletten Weg (App → lokaler Proxy → API → Vergleich →
 * Prüfansicht) zu testen, ohne echte Rechnungsdaten zu übertragen und ohne
 * einen echten API-Key zu benötigen.
 *
 * Die Antwort weicht bewusst in einem Feld ab (Menge der ersten Position),
 * damit die Abweichungs-Behandlung sichtbar wird.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 8788)

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/v1/models') {
    json(res, 200, { data: [{ id: 'mock-sonnet-test', display_name: 'Mock Sonnet' }] })
    return
  }

  if (url.pathname === '/v1/messages' && req.method === 'POST') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))

      // Anfrage prüfen: PDF als Dokument-Block und erzwungenes Werkzeug
      const content = payload.messages?.[0]?.content ?? []
      const document = content.find((b) => b.type === 'document')
      const checks = {
        hatDokument: !!document,
        mediaType: document?.source?.media_type,
        base64Laenge: document?.source?.data?.length ?? 0,
        toolChoice: payload.tool_choice?.name,
        model: payload.model,
      }
      console.log('[mock] Anfrage:', JSON.stringify(checks))

      if (!document || checks.mediaType !== 'application/pdf' || checks.base64Laenge < 100) {
        json(res, 400, { error: { message: 'Es wurde keine PDF im Dokument-Block übermittelt.' } })
        return
      }

      json(res, 200, {
        id: 'msg_mock',
        content: [
          {
            type: 'tool_use',
            id: 'tu_mock',
            name: 'rechnungsdaten',
            input: {
              language: 'de',
              invoiceNumber: '4711-2026',
              invoiceDate: '05.08.2026',
              vatId: 'BE 0123456789',
              destinationCountryCode: 'AT',
              netWeightTotalKg: 56,
              positions: [
                {
                  positionNumber: '10',
                  productDescription: 'Sprayer K2 rot mit Kappe 28/410',
                  customsCode: '39235000',
                  // Bewusste Abweichung: die App liest 1000
                  quantity: 100,
                  amountEur: 125,
                },
                {
                  positionNumber: '20',
                  productDescription: 'Zyl.Flasche 250 ml natur Gew.:20 g',
                  customsCode: '39233010',
                  quantity: 252,
                  amountEur: 75.6,
                  weightPerPieceGrams: 20,
                },
              ],
              uncertainFields: [],
            },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    })
    return
  }

  json(res, 404, { error: { message: 'unbekannter Endpunkt' } })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] Anthropic-Nachbildung auf http://127.0.0.1:${PORT}`)
})
