import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import './App.css'
import { StepNav } from './components/StepNav'
import { FileDropzone } from './components/FileDropzone'
import { UploadButton } from './components/UploadButton'
import { ReviewTable } from './components/ReviewTable'
import { PreviewTable } from './components/PreviewTable'
import { ExportSummaryView } from './components/ExportSummaryView'
import type { Company, Invoice, InvoiceDirection, InvoicePosition, ProductWeightEntry } from './types'
import { checkAiAvailability, type AiAvailability } from './lib/aiVerification'
import { ARTIKEL_GEWICHTSMAPPING, ARTIKEL_GEWICHTSMAPPING_STAND } from './data/artikelGewichtsmapping'
import { parseArtikelGewichtsmappingXlsx } from './lib/weightList'
import {
  loadBundledTemplate,
  loadTemplate,
  createExportBuffer,
  buildExportFileName,
  MUSTERTABELLE_STAND,
} from './lib/excelTemplate'
import { processInvoiceFile, recalculateInvoice } from './lib/processing'
import {
  deriveReferencePeriod,
  normalizeInvoiceDateInput,
  buildManualInvoice,
  buildManualPosition,
  isNonMerchandiseArticleNumber,
} from './lib/aiInvoiceBuilder'
import { formatGermanDate } from './lib/germanNumber'
import { saveAddressCountryOverride, clearCountryMappings } from './lib/mappingStore'
import {
  loadWeightListHistory,
  saveWeightListVersion,
  type WeightListVersion,
} from './lib/weightListHistory'
import { loadActiveWeightMap, saveActiveWeightMap } from './lib/activeWeightMapStore'
import { summarizeInvoices } from './lib/calculations'
import klaegerGroupSchwarz from './assets/klaeger-group-schwarz.png'
import klaegerSpcPetrol from './assets/klaeger-spc-petrol.png'
import klaegerStRot from './assets/klaeger-st-rot.png'

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const CURRENT_YEAR = 2026
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(String)

const DIRECTION_LABEL: Record<InvoiceDirection, string> = { V: 'Ausgangsrechnungen', E: 'Eingangsrechnungen' }
const OTHER_DIRECTION: Record<InvoiceDirection, InvoiceDirection> = { V: 'E', E: 'V' }

/**
 * Je Firma eigenes Farbschema (aus den hinterlegten CI-Vorgaben "Kläger.pdf"
 * bzw. "Hartha.pdf") sowie das Präfix für den Dateinamen beim Export. Wird
 * als CSS-Variablen auf die Wurzel der App angewendet, sobald eine Firma
 * gewählt wurde (siehe App-Komponente).
 *
 * "brand" ist die Hauptfarbe der Firma (Logo, Titel, Direktions-Überschrift).
 * "accent" ist die zweite CI-Farbe (Aubergine bzw. Mirabelle), in der die
 * operativen Buttons (Vorgangsschritte, Aktionen in den Rechnungen – außer
 * "übernehmen" – sowie darunter) dargestellt werden, damit Haupt- und
 * Bedienfarbe der Firma sich sichtbar unterscheiden.
 */
const COMPANY_THEME: Record<
  Company,
  {
    label: string
    brand: string
    brandDark: string
    brandTint: string
    brandBorder: string
    accent: string
    accentDark: string
    accentTint: string
    accentText: string
    exportPrefix: string
  }
> = {
  ST: {
    label: 'Kläger Spraying Technology',
    brand: '#AE0F0A',
    brandDark: '#370B28',
    brandTint: '#FBEBEA',
    brandBorder: '#F0C6C4',
    accent: '#370B28',
    accentDark: '#2C0920',
    accentTint: '#F2E9EF',
    accentText: '#FFFFFF',
    exportPrefix: 'KST',
  },
  SPC: {
    label: 'Kläger Performance Components',
    brand: '#005A69',
    brandDark: '#141229',
    brandTint: '#E8F2F3',
    brandBorder: '#BFDEE2',
    accent: '#FDC400',
    accentDark: '#CA9D00',
    accentTint: '#FFF6D9',
    accentText: '#1A1A1A',
    exportPrefix: 'KSPC',
  },
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Vor der Firmenwahl steht das Kläger-Group-Logo in Schwarz (Originaldatei).
 * Nach der Wahl wird dieselbe Bildmarke per CSS-Maske in der Firmenfarbe
 * eingefärbt ("weiße" Variante gibt es als eigene Datei nicht) – die Maske
 * nutzt den Alphakanal des Schwarz-Logos, die Füllfarbe kommt von
 * `background-color`.
 */
function AppHeader({ subtitle, company }: { subtitle?: ReactNode; company: Company | null }) {
  return (
    <header className={`app__header${company ? '' : ' app__header--select'}`}>
      {company ? (
        <span
          className="app__logo app__logo--mask"
          role="img"
          aria-label="Kläger Group"
          style={{
            WebkitMaskImage: `url(${klaegerGroupSchwarz})`,
            maskImage: `url(${klaegerGroupSchwarz})`,
            backgroundColor: COMPANY_THEME[company].brand,
          }}
        />
      ) : (
        <img src={klaegerGroupSchwarz} alt="Kläger Group" className="app__logo" />
      )}
      <h1>INTRASTAT-Meldung</h1>
      {subtitle && <p>{subtitle}</p>}
    </header>
  )
}

function VersionFooter() {
  return <footer className="app__version-footer">{__APP_VERSION__}</footer>
}

/**
 * Eine Zeile im "hinterlegte Grunddaten"-Bereich für die Gewichtsliste einer
 * Richtung (AR = Ausgangs-, ER = Eingangsrechnungen). Ausgangsrechnungen
 * haben zusätzlich einen fest hinterlegten Werksstand, zu dem zurückgesetzt
 * werden kann; Eingangsrechnungen starten leer und wachsen ausschließlich
 * durch manuelle Korrekturen (siehe App.handleConfirmProductMapping) bzw.
 * optionalen Upload.
 */
function WeightListRow({
  hasBundledDefault,
  label,
  weightMap,
  stand,
  history,
  showView,
  showReset,
  onToggleView,
  onToggleReset,
  onUpload,
  onApplyVersion,
}: {
  /** Nur für Ausgangsrechnungen bei Kläger Spraying Technology (KST) gibt es einen fest hinterlegten Werksstand. */
  hasBundledDefault: boolean
  label: string
  weightMap: Record<string, number>
  stand: string
  history: WeightListVersion[]
  showView: boolean
  showReset: boolean
  onToggleView: () => void
  onToggleReset: () => void
  onUpload: (file: File) => void
  onApplyVersion: (version: WeightListVersion | 'bundled' | 'empty') => void
}) {
  return (
    <div className="bundled-info__row">
      <div className="bundled-info__status">
        <p>
          {stand ? (
            <>
              Gewichtsliste ({label}) mit Datenstand vom <strong className="stand">{stand}</strong> hinterlegt
            </>
          ) : (
            <>
              Gewichtsliste ({label}): <strong className="stand">noch keine Daten hinterlegt</strong>
            </>
          )}
        </p>
      </div>
      <div className="bundled-info__actions">
        <UploadButton label={`Upload einer aktuellen Gewichtsliste (${label})`} accept=".xlsx" onFile={onUpload} />
        <button type="button" onClick={onToggleView}>
          Gespeicherte Gewichtsliste anzeigen ({label})
        </button>
        <button type="button" onClick={onToggleReset}>
          Aktuelle Gewichtsliste zurücksetzen ({label})
        </button>
      </div>

      {showView && (
        <div className="bundled-info__panel">
          <p className="hint">
            Aktives Artikel-Gewichtsmapping {label} ({Object.keys(weightMap).length} Artikel
            {stand ? `, Stand ${stand}` : ''}):
          </p>
          <div className="weightlist-view">
            <table>
              <thead>
                <tr>
                  <th>Artikelnummer</th>
                  <th>Gewicht je Stück (g)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(weightMap).map(([articleNumber, grams]) => (
                  <tr key={articleNumber}>
                    <td>{articleNumber}</td>
                    <td>{grams}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showReset && (
        <div className="bundled-info__panel">
          <p className="hint">Auf einen früheren Stand zurücksetzen:</p>
          <ul className="weightlist-history">
            {history.map((version) => (
              <li key={version.id}>
                <button type="button" onClick={() => onApplyVersion(version)}>
                  Stand vom {formatGermanDate(new Date(version.savedAt))} ({Object.keys(version.entries).length}{' '}
                  Artikel{version.sourceFileName ? `, aus „${version.sourceFileName}“` : ''})
                </button>
              </li>
            ))}
            <li>
              {hasBundledDefault ? (
                <button type="button" onClick={() => onApplyVersion('bundled')}>
                  Werksstand (fest hinterlegt vom {ARTIKEL_GEWICHTSMAPPING_STAND})
                </button>
              ) : (
                <button type="button" onClick={() => onApplyVersion('empty')}>
                  Leere Liste (kein Werksstand hinterlegt)
                </button>
              )}
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

function App() {
  const [step, setStep] = useState(1)

  // Firma (Kläger Spraying Technology / Kläger Performance Components).
  // null = Firmenauswahl, steht VOR der Richtungsauswahl.
  const [company, setCompany] = useState<Company | null>(null)

  // Richtung (Ausgangs-/Eingangsrechnungen). null = Auswahlbildschirm.
  const [direction, setDirection] = useState<InvoiceDirection | null>(null)
  // Bereits abgeschlossen erfasste Rechnungen der jeweils anderen Richtung,
  // damit am Ende beide Richtungen in einer gemeinsamen Datei landen.
  const [finishedInvoicesByDirection, setFinishedInvoicesByDirection] = useState<
    Partial<Record<InvoiceDirection, Invoice[]>>
  >({})

  // Artikel-Gewichtsmapping und Mustertabelle sind fest hinterlegt, können
  // aber ersetzt werden. Jede Firma führt fachlich getrennte Artikel-Kataloge
  // (siehe mappingStore.ts) UND jeweils eine EIGENE Gewichtsliste je Richtung
  // (AR/ER): Nur Ausgangsrechnungen bei Kläger Spraying Technology (KST)
  // starten mit dem hinterlegten Werksstand, alle anderen Kombinationen
  // starten leer und wachsen durch manuelle Korrekturen bzw. optionalen
  // Upload. Der tatsächliche Inhalt wird erst geladen, sobald eine Firma
  // gewählt wurde (siehe useEffect weiter unten) – vor der Firmenwahl bleiben
  // diese Listen leer, da sie an dieser Stelle ohnehin nicht angezeigt werden.
  const [weightMaps, setWeightMaps] = useState<Record<InvoiceDirection, Record<string, number>>>({ V: {}, E: {} })
  const [weightListStands, setWeightListStands] = useState<Record<InvoiceDirection, string>>({ V: '', E: '' })
  const [weightListHistories, setWeightListHistories] = useState<Record<InvoiceDirection, WeightListVersion[]>>({
    V: [],
    E: [],
  })
  const [showWeightListView, setShowWeightListView] = useState<Record<InvoiceDirection, boolean>>({
    V: false,
    E: false,
  })
  const [showWeightListReset, setShowWeightListReset] = useState<Record<InvoiceDirection, boolean>>({
    V: false,
    E: false,
  })

  const [customTemplateFile, setCustomTemplateFile] = useState<File | null>(null)
  const [templateStand, setTemplateStand] = useState<string>(MUSTERTABELLE_STAND)
  const [templateStatus, setTemplateStatus] = useState<'lade' | 'ok' | 'fehler'>('lade')
  const [templateSheetName, setTemplateSheetName] = useState<string>('')
  const [templateError, setTemplateError] = useState<string | null>(null)

  const [selectedMonth, setSelectedMonth] = useState('08')
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR))

  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  // Claude ist die einzige Quelle der Rechnungsdaten. Ohne erreichbaren
  // lokalen Proxy ist die App nicht funktionsfähig (siehe Blockbildschirm
  // unten).
  const [aiAvailability, setAiAvailability] = useState<AiAvailability>({ available: false, model: null })
  const [aiAvailabilityChecked, setAiAvailabilityChecked] = useState(false)
  const [filesByInvoiceId, setFilesByInvoiceId] = useState<Record<string, File>>({})

  // Hinterlegte Mustertabelle beim Start prüfen, damit ein Problem früh sichtbar wird.
  useEffect(() => {
    let cancelled = false
    loadBundledTemplate()
      .then((info) => {
        if (cancelled) return
        setTemplateSheetName(info.worksheetName)
        setTemplateStatus('ok')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTemplateStatus('fehler')
        setTemplateError(err instanceof Error ? err.message : 'Unbekannter Fehler')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Wird eine Gewichtsliste ersetzt oder zurückgesetzt, müssen alle bereits
  // zugeordneten Artikelgewichte (und die davon abhängigen Berechnungen)
  // sofort neu ermittelt werden – sonst rechnet die Prüfansicht scheinbar
  // "hängengeblieben" mit einem Wert weiter, der in der Gewichtsliste gar
  // nicht mehr steht. Betrifft die laufend erfasste Richtung ebenso wie eine
  // bereits pausierte andere Richtung, da deren Werte in den finalen Export
  // einfließen.
  useEffect(() => {
    setInvoices((prev) => prev.map((inv) => recalculateInvoice(inv, weightMaps, selectedMonth, selectedYear)))
    setFinishedInvoicesByDirection((prev) => {
      const next: Partial<Record<InvoiceDirection, Invoice[]>> = {}
      for (const key of Object.keys(prev) as InvoiceDirection[]) {
        next[key] = prev[key]?.map((inv) => recalculateInvoice(inv, weightMaps, selectedMonth, selectedYear))
      }
      return next
    })
    // Nur bei Änderung der Gewichtslisten selbst neu berechnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightMaps])

  // Sobald eine Firma gewählt wurde (oder gewechselt wird, siehe
  // "Firma wechseln"), deren eigenständigen Gewichtslisten-Stand laden – nur
  // Ausgangsrechnungen bei KST starten mit dem hinterlegten Werksstand, alle
  // anderen Kombinationen leer, sofern nichts Abweichendes gespeichert ist.
  useEffect(() => {
    if (!company) return
    const v = loadActiveWeightMap(company, 'V')
    const e = loadActiveWeightMap(company, 'E')
    setWeightMaps({
      V: v?.entries ?? (company === 'ST' ? ARTIKEL_GEWICHTSMAPPING : {}),
      E: e?.entries ?? {},
    })
    setWeightListStands({
      V: v?.stand ?? (company === 'ST' ? ARTIKEL_GEWICHTSMAPPING_STAND : ''),
      E: e?.stand ?? '',
    })
    setWeightListHistories({
      V: loadWeightListHistory(company, 'V'),
      E: loadWeightListHistory(company, 'E'),
    })
  }, [company])

  // Aktiven Gewichtsliste-Stand je Firma/Richtung dauerhaft merken (siehe
  // activeWeightMapStore.ts) – sonst gingen z. B. einzeln in der Prüfansicht
  // bestätigte Artikelgewichte bei einem Neuladen der Seite verloren.
  useEffect(() => {
    if (!company) return
    saveActiveWeightMap(company, 'V', weightMaps.V, weightListStands.V)
    saveActiveWeightMap(company, 'E', weightMaps.E, weightListStands.E)
  }, [company, weightMaps, weightListStands])

  // Verfügbarkeit des lokalen Claude-Proxys prüfen.
  useEffect(() => {
    let cancelled = false
    checkAiAvailability().then((result) => {
      if (cancelled) return
      setAiAvailability(result)
      setAiAvailabilityChecked(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Ersetzt das aktive Artikel-Gewichtsmapping einer Richtung durch eine
   * hochgeladene Datei. Der neue Stand wird zusätzlich im Verlauf DIESER
   * Richtung gemerkt (höchstens die letzten 5 Versionen, ältester Eintrag
   * fällt zuerst weg), damit „Aktuelle Gewichtsliste zurücksetzen“ später
   * ohne erneuten Upload dorthin zurückkehren kann.
   */
  async function handleReplaceWeightList(direction: InvoiceDirection, file: File) {
    if (!company) return
    try {
      const entries = await parseArtikelGewichtsmappingXlsx(file)
      if (Object.keys(entries).length === 0) {
        window.alert('In der Datei wurden keine Artikel-/Gewichtsangaben erkannt. Die aktuelle Zuordnung bleibt aktiv.')
        return
      }
      const version = saveWeightListVersion(company, direction, entries, file.name)
      setWeightListHistories((prev) => ({ ...prev, [direction]: loadWeightListHistory(company, direction) }))
      setWeightMaps((prev) => ({ ...prev, [direction]: entries }))
      setWeightListStands((prev) => ({ ...prev, [direction]: formatGermanDate(new Date(version.savedAt)) }))
      setShowWeightListReset((prev) => ({ ...prev, [direction]: false }))
    } catch {
      window.alert('Die Datei konnte nicht gelesen werden. Die aktuelle Zuordnung bleibt aktiv.')
    }
  }

  /**
   * Übernimmt für eine Richtung eine frühere Version aus dem Verlauf, den
   * fest hinterlegten Werksstand (nur Ausgangsrechnungen) oder eine leere
   * Liste (nur Eingangsrechnungen, da es dafür keinen Werksstand gibt).
   */
  function handleApplyWeightListVersion(direction: InvoiceDirection, version: WeightListVersion | 'bundled' | 'empty') {
    if (version === 'bundled') {
      setWeightMaps((prev) => ({ ...prev, V: ARTIKEL_GEWICHTSMAPPING }))
      setWeightListStands((prev) => ({ ...prev, V: ARTIKEL_GEWICHTSMAPPING_STAND }))
    } else if (version === 'empty') {
      setWeightMaps((prev) => ({ ...prev, [direction]: {} }))
      setWeightListStands((prev) => ({ ...prev, [direction]: '' }))
    } else {
      setWeightMaps((prev) => ({ ...prev, [direction]: version.entries }))
      setWeightListStands((prev) => ({ ...prev, [direction]: formatGermanDate(new Date(version.savedAt)) }))
    }
    setShowWeightListReset((prev) => ({ ...prev, [direction]: false }))
  }

  /** Ersetzt die aktive Mustertabelle durch eine hochgeladene Datei (nur für die laufende Sitzung). */
  async function handleReplaceTemplate(file: File) {
    setTemplateStatus('lade')
    try {
      const info = await loadTemplate(file)
      setTemplateSheetName(info.worksheetName)
      setTemplateStatus('ok')
      setCustomTemplateFile(file)
      setTemplateStand(formatGermanDate(new Date()))
    } catch (err) {
      setTemplateStatus('fehler')
      setTemplateError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    }
  }

  /** Wählt die Rechnungsart und nimmt einen bereits begonnenen Durchlauf wieder auf. */
  function handleSelectDirection(next: InvoiceDirection) {
    const alreadyCaptured = finishedInvoicesByDirection[next] ?? []
    setDirection(next)
    setInvoices(alreadyCaptured)
    setInvoiceFiles([])
    setStep(alreadyCaptured.length > 0 ? 4 : 1)
  }

  function handleInvoiceFiles(files: File[]) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name))
    if (pdfs.length < files.length) {
      window.alert('Es können nur PDF-Dateien als Rechnungen verarbeitet werden.')
    }
    setInvoiceFiles((prev) => [...prev, ...pdfs])
  }

  function removeInvoiceFile(index: number) {
    setInvoiceFiles((prev) => prev.filter((_, i) => i !== index))
  }

  /** Lässt Claude alle aktuell ausgewählten Dateien auslesen und hängt die Ergebnisse an. */
  async function runAnalysis(): Promise<void> {
    if (!direction || invoiceFiles.length === 0) return
    setAnalyzing(true)
    const results: Invoice[] = []
    const fileMap: Record<string, File> = {}
    for (const file of invoiceFiles) {
      setAnalyzeProgress({ done: results.length, total: invoiceFiles.length, current: file.name })
      const invoice = await processInvoiceFile(file, direction, weightMaps, selectedMonth, selectedYear)
      results.push(invoice)
      fileMap[invoice.id] = file
    }
    setAnalyzeProgress({ done: results.length, total: invoiceFiles.length, current: '' })
    setFilesByInvoiceId((prev) => ({ ...prev, ...fileMap }))
    setInvoices((prev) => [...prev, ...results])
    setInvoiceFiles([])
    setAnalyzing(false)
  }

  async function handleAnalyze() {
    await runAnalysis()
    setStep(4)
  }

  /**
   * Erfasst nur manuell, ganz ohne PDF-Analyse. Der Button ist deaktiviert,
   * sobald bereits Dateien ausgewählt wurden – beides gleichzeitig ist
   * bewusst nicht möglich, da dieser Weg ausschließlich die rein manuelle
   * Erfassung ohne vorherige PDF-Analyse startet.
   */
  function handleManualEntryOnly() {
    if (!direction) return
    const invoice = recalculateInvoice(buildManualInvoice(newId('manual'), direction), weightMaps, selectedMonth, selectedYear)
    setInvoices((prev) => [...prev, invoice])
    setStep(4)
  }

  function handleAddManualInvoice() {
    if (!direction) return
    const invoice = recalculateInvoice(buildManualInvoice(newId('manual'), direction), weightMaps, selectedMonth, selectedYear)
    setInvoices((prev) => [...prev, invoice])
  }

  /** Entfernt eine manuell hinzugefügte Rechnung wieder, z. B. bei versehentlichem Klick. */
  function handleRemoveInvoice(invoiceId: string) {
    setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId))
  }

  /** Liest eine einzelne Rechnung erneut mit Claude aus (nach einem Fehler). */
  async function handleRetryInvoice(invoiceId: string) {
    if (!direction) return
    const file = filesByInvoiceId[invoiceId]
    if (!file) return
    setRetryingId(invoiceId)
    try {
      const refreshed = await processInvoiceFile(file, direction, weightMaps, selectedMonth, selectedYear)
      setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? { ...refreshed, id: invoiceId } : inv)))
    } finally {
      setRetryingId(null)
    }
  }

  function updateInvoiceById(invoiceId: string, updater: (invoice: Invoice) => Invoice) {
    setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? updater(inv) : inv)))
  }

  function handleEditPosition(invoiceId: string, positionId: string, patch: Partial<InvoicePosition>, field: string) {
    updateInvoiceById(invoiceId, (invoice) => {
      const positions = invoice.positions.map((p) => {
        if (p.id !== positionId) return p
        const original = (p as unknown as Record<string, unknown>)[field]
        const next: InvoicePosition = {
          ...p,
          ...patch,
          manualCorrections: [
            ...p.manualCorrections,
            { field, originalValue: original, newValue: (patch as Record<string, unknown>)[field], timestamp: 0 },
          ],
        }
        // Bei geänderter Produktbezeichnung die Zuordnung neu ermitteln lassen.
        if (field === 'productNameRaw') {
          next.productMatch = undefined
        }
        // Warennummer 39233010 steuert Spalte M.
        if (field === 'customsCode') {
          next.isSpecialUnit = next.customsCode === '39233010'
        }
        // Artikelnummer bestimmt, ob es sich um eine "09"-Wertposition handelt.
        if (field === 'articleNumberRaw') {
          next.isTransportCost = isNonMerchandiseArticleNumber(next.articleNumberRaw) && !next.isMtzSurcharge
          next.productMatch = undefined
        }
        return next
      })
      return recalculateInvoice({ ...invoice, positions }, weightMaps, selectedMonth, selectedYear)
    })
  }

  /**
   * Manuell hinzugefügte Positionen erhalten eine Positionsnummer in der
   * auf Rechnungen üblichen Zehnerfolge (10, 20, 30, …), damit sie sich
   * optisch nicht von real ausgelesenen Positionen unterscheiden.
   */
  function handleAddPosition(invoiceId: string) {
    updateInvoiceById(invoiceId, (invoice) => {
      const existingNumbers = invoice.positions
        .map((p) => Number(p.positionNumber))
        .filter((n) => Number.isFinite(n))
      const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 10 : 10
      const positions = [...invoice.positions, buildManualPosition(String(nextNumber))]
      return recalculateInvoice({ ...invoice, positions }, weightMaps, selectedMonth, selectedYear)
    })
  }

  function handleRemovePosition(invoiceId: string, positionId: string) {
    updateInvoiceById(invoiceId, (invoice) => {
      const positions = invoice.positions.filter((p) => p.id !== positionId)
      return recalculateInvoice({ ...invoice, positions }, weightMaps, selectedMonth, selectedYear)
    })
  }

  /**
   * Bestätigt eine von 0 kg abweichende Differenz zwischen berechnetem und
   * ausgewiesenem Gewicht manuell. Ändert keine Artikelgewichte oder
   * sonstigen Regelungen, hebt nur die Export-Sperre für diese Rechnung auf.
   */
  function handleAcceptWeightTolerance(invoiceId: string) {
    updateInvoiceById(invoiceId, (invoice) =>
      recalculateInvoice({ ...invoice, weightToleranceAccepted: true }, weightMaps, selectedMonth, selectedYear),
    )
  }

  function handleEditInvoice(invoiceId: string, patch: Partial<Invoice>, field: string) {
    updateInvoiceById(invoiceId, (invoice) => {
      // Erlaubt die Eingabe des Rechnungsdatums auch ohne Punkte
      // ("01072026"/"010726") und wandelt es automatisch ins Format
      // TT.MM.JJJJ um.
      if (field === 'invoiceDateRaw' && typeof patch.invoiceDateRaw === 'string') {
        patch = { ...patch, invoiceDateRaw: normalizeInvoiceDateInput(patch.invoiceDateRaw) }
      }
      const original = (invoice as unknown as Record<string, unknown>)[field]
      const updated: Invoice = {
        ...invoice,
        ...patch,
        manualCorrections: [
          ...invoice.manualCorrections,
          { field, originalValue: original, newValue: (patch as Record<string, unknown>)[field], timestamp: 0 },
        ],
      }
      // Bezugsmonat folgt dem Rechnungsdatum.
      if (field === 'invoiceDateRaw') {
        const period = deriveReferencePeriod(updated.invoiceDateRaw)
        updated.referenceMonth = period?.month
        updated.referenceYear = period?.year
      }
      return recalculateInvoice(updated, weightMaps, selectedMonth, selectedYear)
    })
  }

  /**
   * Bestätigt bzw. korrigiert das Bestimmungsland. Die Entscheidung wird
   * adressgenau dauerhaft gemerkt und hat bei künftigen Läufen Vorrang vor der
   * automatischen Erkennung durch Claude.
   */
  function handleConfirmCountry(invoiceId: string, isoCode: string) {
    const invoice = invoices.find((inv) => inv.id === invoiceId)
    if (!invoice) return

    const addressText = invoice.destinationAddressText

    if (isoCode) {
      saveAddressCountryOverride(addressText, isoCode)
    }

    updateInvoiceById(invoiceId, (inv) => {
      const updated: Invoice = {
        ...inv,
        destinationCountry: {
          code: isoCode || null,
          source: isoCode ? 'manual' : 'unresolved',
          isManual: true,
          needsConfirmation: false,
        },
        manualCorrections: [
          ...inv.manualCorrections,
          {
            field: 'destinationCountry',
            originalValue: inv.destinationCountry?.code ?? null,
            newValue: isoCode || null,
            timestamp: 0,
          },
        ],
      }
      return recalculateInvoice(updated, weightMaps, selectedMonth, selectedYear)
    })

    // Dieselbe Adresse in weiteren Rechnungen desselben Durchlaufs übernehmen.
    if (isoCode && addressText) {
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.id === invoiceId) return inv
          if (inv.destinationCountry?.isManual) return inv
          if (inv.destinationAddressText !== addressText) return inv
          const updated: Invoice = {
            ...inv,
            destinationCountry: {
              code: isoCode,
              source: 'gelernte-zuordnung',
              isManual: false,
              needsConfirmation: false,
            },
          }
          return recalculateInvoice(updated, weightMaps, selectedMonth, selectedYear)
        }),
      )
    }
  }

  /**
   * Bestätigt bzw. korrigiert das Gewicht einer Position – sei es durch
   * manuelle Eingabe eines Werts (z. B. wenn keine automatische Zuordnung
   * gefunden wird oder das hinterlegte Artikel-Gewichtsmapping veraltete
   * Werte enthält). Mit Artikelnummer landet die Korrektur DIREKT in der
   * jeweils eigenen Gewichtsliste (siehe App.WeightListRow) – es gibt bewusst
   * KEINEN separaten, davon losgelösten Speicher mehr dafür, damit ein
   * späteres Ersetzen/Zurücksetzen der Gewichtsliste sich immer sofort und
   * korrekt auswirkt (siehe productMatcher.ts). Ohne Artikelnummer gilt die
   * Korrektur nur für diese eine Position.
   */
  function handleConfirmProductMapping(invoiceId: string, positionId: string, entry: ProductWeightEntry) {
    const invoice = invoices.find((inv) => inv.id === invoiceId)
    const position = invoice?.positions.find((p) => p.id === positionId)
    if (!position || !invoice) return

    const richtung = invoice.richtung
    const articleNumber = position.articleNumberRaw?.trim()

    // `weightMaps` (State) ist an dieser Stelle noch der ALTE Wert (React-
    // State-Updates sind asynchron) – für die Neuberechnung im selben
    // Durchlauf wird deshalb eine lokal zusammengeführte Kopie verwendet.
    let nextWeightMaps = weightMaps
    if (articleNumber) {
      nextWeightMaps = { ...weightMaps, [richtung]: { ...weightMaps[richtung], [articleNumber]: entry.unitWeightGrams } }
      setWeightMaps(nextWeightMaps)
      setWeightListStands((prev) => ({ ...prev, [richtung]: formatGermanDate(new Date()) }))
    }

    // Auf alle Positionen mit derselben Artikelnummer UND Richtung im
    // aktuellen Durchlauf anwenden (AR- und ER-Artikelnummern sind fachlich
    // getrennte Kataloge); ohne Artikelnummer gilt die Korrektur nur für
    // diese Position. Mit Artikelnummer wird die Neuberechnung die frisch
    // gesetzte `productMatch`-Markierung sofort wieder gegen die aktuelle
    // Gewichtsliste ersetzen (siehe processing.ts) – das ist gewünscht, da
    // beide auf denselben (soeben aktualisierten) Wert verweisen.
    setInvoices((prev) =>
      prev.map((inv) => {
        const matches = (p: InvoicePosition) =>
          p.id === position.id ||
          (!!articleNumber && inv.richtung === richtung && p.articleNumberRaw?.trim() === articleNumber)
        const affected = inv.positions.some(matches)
        if (!affected) return inv
        const positions = inv.positions.map((p) =>
          matches(p) ? { ...p, productMatch: { matchType: 'manual' as const, entry, suggestions: [] } } : p,
        )
        return recalculateInvoice({ ...inv, positions }, nextWeightMaps, selectedMonth, selectedYear)
      }),
    )
  }

  function handleNegativeDecision(invoiceId: string, positionId: string, include: boolean) {
    updateInvoiceById(invoiceId, (invoice) => {
      const positions = invoice.positions.map((p) =>
        p.id === positionId
          ? {
              ...p,
              isCreditOrDiscountOrNegative: !include,
              negativeDecisionMade: true,
              manualCorrections: [
                ...p.manualCorrections,
                {
                  field: 'negativeDecision',
                  originalValue: 'unentschieden',
                  newValue: include ? 'übernommen' : 'ausgeschlossen',
                  timestamp: 0,
                },
              ],
            }
          : p,
      )
      return recalculateInvoice({ ...invoice, positions }, weightMaps, selectedMonth, selectedYear)
    })
  }

  const otherDirection = direction ? OTHER_DIRECTION[direction] : null
  // Vorschau, Zusammenfassung und Export fassen die aktuelle Richtung und
  // eine bereits abgeschlossene andere Richtung zu EINER Liste zusammen.
  const combinedInvoices = [...(otherDirection ? finishedInvoicesByDirection[otherDirection] ?? [] : []), ...invoices]

  // Erscheint rechtsbündig neben der Überschrift, ausschließlich in Schritt 6,
  // sobald die jeweils andere Richtung bereits (zumindest einmal)
  // erfasst/pausiert wurde. Springt – anders als der Wechsel in Schritt 5 –
  // immer zurück in deren Vorschau (Schritt 5), nicht zum Datei-Upload.
  const switchBackToOtherDirectionPreviewButton =
    otherDirection && finishedInvoicesByDirection[otherDirection] ? (
      <button type="button" onClick={() => handleSwitchDirection(5)}>
        Zurück zu den <strong>{DIRECTION_LABEL[otherDirection]}</strong>
      </button>
    ) : null

  // `combinedInvoices` wird bei jedem Rendern neu zusammengesetzt (aktuelle
  // Richtung + ggf. bereits abgeschlossene andere Richtung); ein `useMemo`
  // darüber würde nichts einsparen.
  const summary = summarizeInvoices(combinedInvoices)

  // Sind BEIDE Richtungen erfasst, zeigt Schritt 6 die Summen getrennt nach
  // Richtung (links Eingang, rechts Ausgang) statt einer generischen Summe.
  const invoicesByDirectionForSummary: Record<InvoiceDirection, Invoice[]> = {
    V: direction === 'V' ? invoices : (finishedInvoicesByDirection.V ?? []),
    E: direction === 'E' ? invoices : (finishedInvoicesByDirection.E ?? []),
  }
  const bothDirectionsCaptured =
    invoicesByDirectionForSummary.V.length > 0 && invoicesByDirectionForSummary.E.length > 0
  const summaryByDirection = bothDirectionsCaptured
    ? {
        eingang: summarizeInvoices(invoicesByDirectionForSummary.E),
        ausgang: summarizeInvoices(invoicesByDirectionForSummary.V),
      }
    : undefined
  // Solange nur eine Richtung erfasst ist, bestimmt sie (nicht zwingend die
  // gerade aktive `direction`), ob "Summe des statistischen Werts" in der
  // einspaltigen Ansicht angezeigt wird.
  const singleSummaryDirection: InvoiceDirection = invoicesByDirectionForSummary.V.length > 0 ? 'V' : 'E'

  const canExport =
    templateStatus === 'ok' &&
    combinedInvoices.length > 0 &&
    summary.generatedRows > 0 &&
    combinedInvoices.every(
      (inv) =>
        !inv.issues.some((i) => i.severity === 'error') &&
        !inv.positions.some((p) => p.issues.some((i) => i.severity === 'error')),
    )

  /**
   * Startet den gesamten Ablauf neu: alle hochgeladenen Rechnungen und
   * Analyseergebnisse beider Richtungen werden entfernt, die App springt
   * zurück zur Richtungsauswahl. Gelernte Produkt-/Länder-Zuordnungen bleiben
   * erhalten.
   */
  function handleStartNewAnalysis() {
    setInvoiceFiles([])
    setInvoices([])
    setAnalyzeProgress(null)
    setFilesByInvoiceId({})
    setRetryingId(null)
    setAnalyzing(false)
    setFinishedInvoicesByDirection({})
    setDirection(null)
    setStep(1)
  }

  /**
   * Springt von Schritt 1 zurück zur Richtungsauswahl (Hauptmenü). Anders als
   * "Neue Analyse starten" geht dabei nichts verloren: Bereits erfasste
   * Rechnungen der aktuellen Richtung werden pausiert (wie bei einem
   * Richtungswechsel) und stehen beim erneuten Auswählen wieder bereit.
   */
  function handleBackToMainMenu() {
    // Nur pausieren, wenn tatsächlich etwas erfasst wurde – eine leere Liste
    // würde die Richtung fälschlich als "abgeschlossen" markieren und dadurch
    // z. B. den "Jetzt X erfassen"-Button unnötig ausblenden.
    if (direction && invoices.length > 0) {
      setFinishedInvoicesByDirection((prev) => ({ ...prev, [direction]: invoices }))
    }
    setInvoiceFiles([])
    setDirection(null)
    setStep(1)
  }

  /**
   * Wechselt zurück zur Firmenauswahl (vorderste Seite). Eine für die
   * aktuelle Firma ggf. pausierte Erfassung wird dabei verworfen, da beide
   * Firmen fachlich getrennte Meldungen mit eigenen Gewichtslisten führen –
   * ein Vermischen der erfassten Rechnungen zwischen Firmen wäre fachlich
   * falsch.
   */
  function handleChangeCompany() {
    setCompany(null)
    setDirection(null)
    setInvoices([])
    setInvoiceFiles([])
    setFinishedInvoicesByDirection({})
    setStep(1)
  }

  /**
   * Schließt die aktuelle Richtung ab und wechselt zur jeweils anderen für
   * denselben Bezugsmonat. Der Bezugsmonat wurde bereits gewählt (Schritt 1
   * gilt für beide Richtungen gemeinsam) und wird deshalb übersprungen.
   *
   * `targetStep` erzwingt einen festen Zielschritt (z. B. 5, wenn aus Schritt
   * 6 in die Vorschau der anderen Richtung zurückgesprungen wird). Ohne
   * Vorgabe wird – wie beim erstmaligen Wechsel aus Schritt 5 – automatisch
   * Schritt 4 (bereits erfasst) oder 2 (noch nichts erfasst) gewählt.
   */
  function handleSwitchDirection(targetStep?: number) {
    if (!direction || !otherDirection) return
    // Nur pausieren, wenn tatsächlich etwas erfasst wurde (siehe
    // handleBackToMainMenu für die Begründung).
    if (invoices.length > 0) {
      setFinishedInvoicesByDirection((prev) => ({ ...prev, [direction]: invoices }))
    }
    const alreadyCaptured = finishedInvoicesByDirection[otherDirection] ?? []
    setDirection(otherDirection)
    setInvoices(alreadyCaptured)
    setInvoiceFiles([])
    setStep(targetStep ?? (alreadyCaptured.length > 0 ? 4 : 2))
  }

  /**
   * Springt von der Prüfansicht zurück zum Rechnungs-Upload. Da dabei
   * typischerweise neu hochgeladen werden soll, wird gefragt, ob die bisher
   * analysierten Rechnungen DIESER Richtung entfernt werden sollen – eine
   * bereits abgeschlossene andere Richtung ist davon nie betroffen.
   */
  function handleBackFromReview() {
    const shouldClear = window.confirm(
      'Sollen alle bisher analysierten Rechnungen der aktuellen Erfassung entfernt werden?',
    )
    if (shouldClear) {
      setInvoices([])
      setInvoiceFiles([])
    }
    setStep(2)
  }

  /**
   * Springt nur dann zur Vorschau (Schritt 5), wenn keine der erfassten
   * Rechnungen (Ein- oder Ausgang) noch auf Status "Fehler" steht – sonst
   * bleibt es bei einer Fehlermeldung, statt stillschweigend weiterzuleiten.
   */
  function handleGoToPreview() {
    const errorCount = combinedInvoices.filter((inv) => inv.status === 'error').length
    if (errorCount > 0) {
      window.alert(
        errorCount === 1
          ? 'Es steht noch 1 Rechnung auf Status „Fehler“ und muss bearbeitet werden, damit fortgefahren werden kann.'
          : `Es stehen noch ${errorCount} Rechnungen auf Status „Fehler“ und müssen bearbeitet werden, damit fortgefahren werden kann.`,
      )
      return
    }
    setStep(5)
  }

  async function handleExport() {
    try {
      const buffer = await createExportBuffer(combinedInvoices, customTemplateFile ?? undefined)
      const fileName = buildExportFileName(selectedMonth, selectedYear, company ? COMPANY_THEME[company].exportPrefix : undefined)
      const blob = new Blob([buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      window.alert(`Der Export ist fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`)
    }
  }

  const fileName = buildExportFileName(selectedMonth, selectedYear, company ? COMPANY_THEME[company].exportPrefix : undefined)

  // Firmenfarbe als CSS-Variablen auf die App anwenden, sobald eine Firma
  // gewählt wurde (siehe COMPANY_THEME) – vor der Wahl gelten die Standardwerte
  // aus App.css (Firmenauswahl-Bildschirm ist bewusst neutral/schwarz).
  const themeStyle: CSSProperties | undefined = company
    ? ({
        '--brand': COMPANY_THEME[company].brand,
        '--brand-dark': COMPANY_THEME[company].brandDark,
        '--brand-tint': COMPANY_THEME[company].brandTint,
        '--brand-border': COMPANY_THEME[company].brandBorder,
        '--accent': COMPANY_THEME[company].accent,
        '--accent-dark': COMPANY_THEME[company].accentDark,
        '--accent-tint': COMPANY_THEME[company].accentTint,
        '--accent-text': COMPANY_THEME[company].accentText,
      } as CSSProperties)
    : undefined

  if (!aiAvailabilityChecked) {
    return (
      <div className="app">
        <AppHeader company={company} />
        <div className="app__body">
          <main className="app__main">
            <p>Prüfe Verbindung zu Claude…</p>
          </main>
        </div>
        <VersionFooter />
      </div>
    )
  }

  if (!aiAvailability.available) {
    return (
      <div className="app">
        <AppHeader company={company} />
        <div className="app__body">
          <main className="app__main">
            <section className="ai-blocked">
              <h2>Keine Verbindung zu Claude</h2>
              <p>
                Claude liest die Rechnungen aus und ist die alleinige Quelle der Rechnungsdaten – es gibt kein
                lokales Fallback. Ohne erreichbaren Proxy mit gültigem API-Key ist die App nicht funktionsfähig.
              </p>
              <p className="hint">
                Bitte <code>ANTHROPIC_API_KEY</code> in der <code>.env</code> hinterlegen und den Proxy starten
                (<code>npm start</code>), dann diese Seite neu laden.
              </p>
            </section>
          </main>
        </div>
        <VersionFooter />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="app">
        <AppHeader company={null} />
        <div className="app__body">
          <main className="app__main">
            <div className="company-panels">
              <button
                type="button"
                className="company-panel company-panel--spc"
                onClick={() => setCompany('SPC')}
              >
                <img src={klaegerSpcPetrol} alt={COMPANY_THEME.SPC.label} />
              </button>
              <button
                type="button"
                className="company-panel company-panel--st"
                onClick={() => setCompany('ST')}
              >
                <img src={klaegerStRot} alt={COMPANY_THEME.ST.label} />
              </button>
            </div>
          </main>
        </div>
        <VersionFooter />
      </div>
    )
  }

  if (!direction) {
    const doneV = finishedInvoicesByDirection.V
    const doneE = finishedInvoicesByDirection.E
    return (
      <div className="app" style={themeStyle}>
        <AppHeader company={company} />
        <div className="app__body">
          <main className="app__main">
            <div className="change-company-row">
              <button type="button" onClick={handleChangeCompany}>
                Firma wechseln
              </button>
            </div>
            <div className="direction-panels">
              <button
                type="button"
                className={`direction-panel button--primary-solid${doneV ? ' direction-panel--done' : ''}`}
                onClick={() => handleSelectDirection('V')}
              >
                <h3>Ausgangsrechnungen</h3>
              </button>
              <button
                type="button"
                className={`direction-panel button--primary-solid${doneE ? ' direction-panel--done' : ''}`}
                onClick={() => handleSelectDirection('E')}
              >
                <h3>Eingangsrechnungen</h3>
              </button>
            </div>
          </main>
        </div>
        <VersionFooter />
      </div>
    )
  }

  return (
    <div className="app" style={themeStyle}>
      <AppHeader company={company} />

      <div className="app__body">
      {step === 1 && (
        <div className="back-to-menu-row">
          <button type="button" className="button--primary-solid" onClick={handleBackToMainMenu}>
            Zurück zum Hauptmenü
          </button>
        </div>
      )}
      <h2 className="direction-heading">{DIRECTION_LABEL[direction]}</h2>

      <StepNav currentStep={step} onNavigate={setStep} />

      <main className="app__main">
        {step === 1 && (
          <section>
            <div className="inline-fields">
              <label>
                Monat
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Jahr
                <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="step-actions">
              <button type="button" className="button--primary-solid" onClick={() => setStep(2)}>
                Weiter
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <FileDropzone
              label="Rechnungen (PDF, Mehrfachauswahl möglich)"
              accept=".pdf"
              multiple
              onFiles={handleInvoiceFiles}
              hint="Alle Rechnungen müssen zum Bezugsmonat gehören – das wird geprüft."
            />
            <ul className="file-list">
              {invoiceFiles.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span>{f.name}</span>
                  <button type="button" onClick={() => removeInvoiceFile(i)}>
                    entfernen
                  </button>
                </li>
              ))}
            </ul>
            <div className="step-actions">
              <button type="button" onClick={() => setStep(1)}>
                Zurück
              </button>
              <button
                type="button"
                className="button--primary-solid"
                disabled={invoiceFiles.length === 0}
                onClick={() => setStep(3)}
              >
                Weiter
              </button>
            </div>
            <div className="step-actions">
              <button type="button" disabled={invoiceFiles.length > 0} onClick={handleManualEntryOnly}>
                Nur manuelle Eingabe
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <p>
              {invoiceFiles.length} Rechnung(en) für den Bezugsmonat {selectedMonth}-{selectedYear}.
            </p>
            {analyzing && analyzeProgress && (
              <p>
                Analysiere {analyzeProgress.done + 1} / {analyzeProgress.total}
                {analyzeProgress.current ? ` – ${analyzeProgress.current}` : ''}
              </p>
            )}
            <div className="step-actions">
              <button type="button" onClick={() => setStep(2)} disabled={analyzing}>
                Zurück
              </button>
              <button type="button" className="button--primary-solid" onClick={handleAnalyze} disabled={analyzing}>
                Analyse starten
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <ReviewTable
              invoices={invoices}
              retryingId={retryingId}
              onEditPosition={handleEditPosition}
              onEditInvoice={handleEditInvoice}
              onConfirmProductMapping={handleConfirmProductMapping}
              onConfirmCountry={handleConfirmCountry}
              onNegativeDecision={handleNegativeDecision}
              onRetryInvoice={handleRetryInvoice}
              onAddPosition={handleAddPosition}
              onRemovePosition={handleRemovePosition}
              onAcceptWeightTolerance={handleAcceptWeightTolerance}
              onRemoveInvoice={handleRemoveInvoice}
            />
            <div className="step-actions">
              <button type="button" onClick={handleBackFromReview}>
                Zurück
              </button>
              <button type="button" onClick={handleAddManualInvoice}>
                Weitere Rechnung manuell hinzufügen
              </button>
              <button type="button" className="button--primary-solid" onClick={handleGoToPreview}>
                Weiter zur Vorschau
              </button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section>
            <PreviewTable invoices={combinedInvoices} />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(4)}>
                Zurück zur Prüfung
              </button>
              <button type="button" className="button--primary-solid" onClick={() => setStep(6)}>
                Weiter zum Export
              </button>
            </div>
            {otherDirection && !finishedInvoicesByDirection[otherDirection] && (
              <div className="step-actions">
                <button type="button" className="button--primary-solid" onClick={() => handleSwitchDirection()}>
                  Jetzt <strong>{DIRECTION_LABEL[otherDirection]}</strong> für den gewählten Bezugsmonat erfassen
                </button>
              </div>
            )}
          </section>
        )}

        {step === 6 && (
          <section>
            {switchBackToOtherDirectionPreviewButton && (
              <div className="step-header">{switchBackToOtherDirectionPreviewButton}</div>
            )}
            <ExportSummaryView
              summary={summary}
              richtung={singleSummaryDirection}
              byDirection={summaryByDirection}
              fileName={fileName}
              onDownload={handleExport}
              canExport={canExport}
            />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(5)}>
                Zurück
              </button>
              <button type="button" className="button--primary-solid" onClick={handleStartNewAnalysis}>
                Neue Analyse starten
              </button>
            </div>
          </section>
        )}
      </main>

      <section className="bundled-info">
        {direction === 'V' ? (
          <WeightListRow
            hasBundledDefault={company === 'ST'}
            label="AR"
            weightMap={weightMaps.V}
            stand={weightListStands.V}
            history={weightListHistories.V}
            showView={showWeightListView.V}
            showReset={showWeightListReset.V}
            onToggleView={() => setShowWeightListView((prev) => ({ ...prev, V: !prev.V }))}
            onToggleReset={() => setShowWeightListReset((prev) => ({ ...prev, V: !prev.V }))}
            onUpload={(file) => handleReplaceWeightList('V', file)}
            onApplyVersion={(version) => handleApplyWeightListVersion('V', version)}
          />
        ) : (
          <WeightListRow
            hasBundledDefault={false}
            label="ER"
            weightMap={weightMaps.E}
            stand={weightListStands.E}
            history={weightListHistories.E}
            showView={showWeightListView.E}
            showReset={showWeightListReset.E}
            onToggleView={() => setShowWeightListView((prev) => ({ ...prev, E: !prev.E }))}
            onToggleReset={() => setShowWeightListReset((prev) => ({ ...prev, E: !prev.E }))}
            onUpload={(file) => handleReplaceWeightList('E', file)}
            onApplyVersion={(version) => handleApplyWeightListVersion('E', version)}
          />
        )}

        <div className="bundled-info__row">
          <div className="bundled-info__status">
            <p title={templateSheetName ? `Arbeitsblatt „${templateSheetName}“` : undefined}>
              Mustertabelle mit Datenstand vom <strong className="stand">{templateStand}</strong> hinterlegt
            </p>
            {templateStatus === 'fehler' && <p className="hint hint--error">Fehler: {templateError}</p>}
          </div>
          <div className="bundled-info__actions">
            <UploadButton label="Mustertabelle ersetzen" accept=".xlsx" onFile={handleReplaceTemplate} />
          </div>
        </div>

        <details>
          <summary>Erweitert</summary>
          <div className="bundled-info__advanced">
            <button
              type="button"
              onClick={() => {
                clearCountryMappings()
                window.alert('Gespeicherte Länder-Zuordnungen wurden gelöscht.')
              }}
            >
              Gespeicherte Länder-Zuordnungen löschen
            </button>
          </div>
        </details>
      </section>
      </div>
      <VersionFooter />
    </div>
  )
}

export default App
