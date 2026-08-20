import type { AiInvoiceFields } from '../types'

/**
 * Anbindung an den lokalen Proxy-Server für die KI-Zweitmeinung.
 *
 * Der API-Key liegt ausschließlich auf dem Server (`.env`). Die App kennt ihn
 * nicht. Ohne laufenden Proxy ist die Funktion einfach nicht verfügbar; die
 * übrige Verarbeitung bleibt vollständig lokal.
 */

/**
 * Basis-URL des Proxys. Im Produktionsbetrieb liefert der Proxy die App selbst
 * aus – dann genügen relative Pfade. Im Entwicklungsmodus (Vite auf Port 5173)
 * läuft der Proxy separat; die Adresse kann über VITE_AI_PROXY_URL gesetzt
 * werden.
 */
const PROXY_BASE = (import.meta.env.VITE_AI_PROXY_URL ?? '').replace(/\/$/, '')

function apiUrl(path: string): string {
  return PROXY_BASE ? `${PROXY_BASE}${path}` : path
}

export type AiAvailability = {
  available: boolean
  model: string | null
  hinweis?: string
}

/** Prüft, ob der Proxy läuft und ein Key hinterlegt ist. */
export async function checkAiAvailability(): Promise<AiAvailability> {
  try {
    const response = await fetch(apiUrl('/api/health'), { method: 'GET' })
    if (!response.ok) return { available: false, model: null }
    const body = (await response.json()) as AiAvailability
    return { available: body.available === true, model: body.model ?? null, hinweis: body.hinweis }
  } catch {
    return { available: false, model: null }
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  // In Blöcken umwandeln, damit auch große PDFs den Aufrufstack nicht sprengen.
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export type AiVerifyResult = { model: string; fields: AiInvoiceFields }

/**
 * Sendet die PDF an den lokalen Proxy und erhält die von der KI gelesenen
 * Felder zurück. ACHTUNG: Hierbei wird die vollständige Rechnung an die
 * Anthropic-API übertragen – der Aufruf erfolgt nur nach ausdrücklicher
 * Aktivierung durch die Nutzerin bzw. den Nutzer.
 */
export async function verifyInvoiceWithAi(file: File): Promise<AiVerifyResult> {
  const pdfBase64 = await fileToBase64(file)

  const response = await fetch(apiUrl('/api/verify'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, pdfBase64 }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? `Prüfung fehlgeschlagen (HTTP ${response.status})`)
  }

  const result = body as { model?: string; fields?: AiInvoiceFields }
  if (!result.fields) throw new Error('Die Antwort enthielt keine Felder.')

  return { model: result.model ?? 'unbekannt', fields: result.fields }
}
