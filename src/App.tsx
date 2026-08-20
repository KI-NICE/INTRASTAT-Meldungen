import { useMemo, useState } from 'react'
import './App.css'
import { StepNav } from './components/StepNav'
import { FileDropzone } from './components/FileDropzone'
import { ReviewTable } from './components/ReviewTable'
import { PreviewTable } from './components/PreviewTable'
import { ExportSummaryView } from './components/ExportSummaryView'
import type { Invoice, InvoicePosition, ProductWeightEntry } from './types'
import { parseWeightListDocx } from './lib/weightList'
import { loadTemplate, buildExportWorkbook, buildExportFileName, type TemplateInfo } from './lib/excelTemplate'
import { processInvoiceFile, recalculateInvoice } from './lib/processing'
import { saveManualMapping, normalizeProductName } from './lib/mappingStore'
import { summarizeInvoices } from './lib/calculations'

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const CURRENT_YEAR = 2026 // Hinweis: Date.now() steht in Automatisierungsumgebungen ggf. nicht zur Verfügung.
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(String)

function App() {
  const [step, setStep] = useState(1)

  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [templateInfo, setTemplateInfo] = useState<TemplateInfo | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const [weightListFile, setWeightListFile] = useState<File | null>(null)
  const [weightList, setWeightList] = useState<ProductWeightEntry[]>([])
  const [weightListError, setWeightListError] = useState<string | null>(null)

  const [selectedMonth, setSelectedMonth] = useState('08')
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR))

  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null)

  const [sessionMappings, setSessionMappings] = useState<Record<string, ProductWeightEntry>>({})

  async function handleTemplateFiles(files: File[]) {
    const file = files[0]
    setTemplateError(null)
    try {
      const info = await loadTemplate(file)
      setTemplateFile(file)
      setTemplateInfo(info)
    } catch (err) {
      setTemplateError('Die Datei konnte nicht als Excel-Mustertabelle gelesen werden.')
      console.error(err)
    }
  }

  async function handleWeightListFiles(files: File[]) {
    const file = files[0]
    setWeightListError(null)
    try {
      const entries = await parseWeightListDocx(file)
      if (entries.length === 0) {
        setWeightListError('In der Datei wurden keine Produkt-/Gewichtsangaben erkannt.')
        return
      }
      setWeightListFile(file)
      setWeightList(entries)
    } catch (err) {
      setWeightListError('Die Gewichtsliste konnte nicht gelesen werden.')
      console.error(err)
    }
  }

  function handleInvoiceFiles(files: File[]) {
    setInvoiceFiles((prev) => [...prev, ...files])
  }

  function removeInvoiceFile(index: number) {
    setInvoiceFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    setAnalyzeProgress({ done: 0, total: invoiceFiles.length })
    const results: Invoice[] = []
    for (const file of invoiceFiles) {
      const invoice = await processInvoiceFile(file, weightList, selectedMonth, selectedYear, sessionMappings)
      results.push(invoice)
      setAnalyzeProgress({ done: results.length, total: invoiceFiles.length })
    }
    setInvoices(results)
    setAnalyzing(false)
    setStep(6)
  }

  function updateInvoiceById(invoiceId: string, updater: (invoice: Invoice) => Invoice) {
    setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? updater(inv) : inv)))
  }

  function handleEditPosition(invoiceId: string, positionId: string, patch: Partial<InvoicePosition>, field: string) {
    updateInvoiceById(invoiceId, (invoice) => {
      const positions = invoice.positions.map((p) => {
        if (p.id !== positionId) return p
        const original = (p as unknown as Record<string, unknown>)[field]
        return {
          ...p,
          ...patch,
          manualCorrections: [
            ...p.manualCorrections,
            { field, originalValue: original, newValue: (patch as Record<string, unknown>)[field], timestamp: 0 },
          ],
        }
      })
      const updated = { ...invoice, positions }
      return recalculateInvoice(updated, weightList, selectedMonth, selectedYear, sessionMappings)
    })
  }

  function handleEditInvoice(invoiceId: string, patch: Partial<Invoice>, field: string) {
    updateInvoiceById(invoiceId, (invoice) => {
      const original = (invoice as unknown as Record<string, unknown>)[field]
      const updated: Invoice = {
        ...invoice,
        ...patch,
        manualCorrections: [
          ...invoice.manualCorrections,
          { field, originalValue: original, newValue: (patch as Record<string, unknown>)[field], timestamp: 0 },
        ],
      }
      return recalculateInvoice(updated, weightList, selectedMonth, selectedYear, sessionMappings)
    })
  }

  function handleConfirmProductMapping(invoiceId: string, positionId: string, entry: ProductWeightEntry) {
    const invoice = invoices.find((inv) => inv.id === invoiceId)
    const position = invoice?.positions.find((p) => p.id === positionId)
    if (!position) return

    saveManualMapping(position.productNameRaw, entry)
    const normalized = normalizeProductName(position.productNameRaw)
    const nextSessionMappings = { ...sessionMappings, [normalized]: entry }
    setSessionMappings(nextSessionMappings)

    // Auf weitere identische Produkte im aktuellen Durchlauf anwenden
    // (Anforderung Abschnitt 5, Punkt 7).
    setInvoices((prev) =>
      prev.map((inv) => {
        const hasMatchingPosition = inv.positions.some(
          (p) => normalizeProductName(p.productNameRaw) === normalized && p.productMatch?.matchType !== 'exact' && p.productMatch?.matchType !== 'normalized',
        )
        if (!hasMatchingPosition) return inv
        const positions = inv.positions.map((p) => {
          if (normalizeProductName(p.productNameRaw) !== normalized) return p
          if (p.productMatch?.matchType === 'exact' || p.productMatch?.matchType === 'normalized') return p
          return { ...p, productMatch: { matchType: 'manual' as const, entry, suggestions: [] } }
        })
        const updated = { ...inv, positions }
        return recalculateInvoice(updated, weightList, selectedMonth, selectedYear, nextSessionMappings)
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
                { field: 'negativeDecision', originalValue: 'unentschieden', newValue: include ? 'übernommen' : 'ausgeschlossen', timestamp: 0 },
              ],
            }
          : p,
      )
      const updated = { ...invoice, positions }
      return recalculateInvoice(updated, weightList, selectedMonth, selectedYear, sessionMappings)
    })
  }

  const summary = useMemo(() => summarizeInvoices(invoices), [invoices])

  const canExport =
    invoices.length > 0 &&
    invoices.every(
      (inv) => !inv.issues.some((i) => i.severity === 'error') && !inv.positions.some((p) => p.issues.some((i) => i.severity === 'error')),
    )

  async function handleExport() {
    if (!templateInfo) return
    const buffer = await buildExportWorkbook(templateInfo, invoices)
    const fileName = buildExportFileName(selectedMonth, selectedYear)
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const fileName = buildExportFileName(selectedMonth, selectedYear)

  return (
    <div className="app">
      <header className="app__header">
        <h1>Intrastat-Meldungen aus PDF-Rechnungen</h1>
        <p>Alle Daten werden ausschließlich lokal im Browser verarbeitet.</p>
      </header>

      <StepNav currentStep={step} />

      <main className="app__main">
        {step === 1 && (
          <section>
            <h2>1. Mustertabelle hochladen</h2>
            <FileDropzone
              label="Mustertabelle.xlsx"
              accept=".xlsx"
              onFiles={handleTemplateFiles}
              hint="Die Struktur, Spaltenreihenfolge und Formatierung bleiben erhalten."
            />
            {templateFile && <p>Geladen: {templateFile.name}</p>}
            {templateError && <p className="error-text">{templateError}</p>}
            <button type="button" disabled={!templateInfo} onClick={() => setStep(2)}>
              Weiter
            </button>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>2. Gewichtsliste hochladen</h2>
            <FileDropzone label="Gewichtsliste.docx" accept=".docx" onFiles={handleWeightListFiles} />
            {weightListFile && <p>Geladen: {weightListFile.name} ({weightList.length} Produkte erkannt)</p>}
            {weightListError && <p className="error-text">{weightListError}</p>}
            <div className="step-actions">
              <button type="button" onClick={() => setStep(1)}>
                Zurück
              </button>
              <button type="button" disabled={weightList.length === 0} onClick={() => setStep(3)}>
                Weiter
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <h2>3. Bezugsmonat auswählen</h2>
            <label>
              Monat:{' '}
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Jahr:{' '}
              <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <p>
              In Spalte B wird nur die zweistellige Monatszahl ({selectedMonth}) exportiert. Das Jahr wird intern für
              die Plausibilitätsprüfung und den Dateinamen ({buildExportFileName(selectedMonth, selectedYear)})
              verwendet.
            </p>
            <div className="step-actions">
              <button type="button" onClick={() => setStep(2)}>
                Zurück
              </button>
              <button type="button" onClick={() => setStep(4)}>
                Weiter
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>4. PDF-Rechnungen hochladen</h2>
            <FileDropzone label="Rechnungen (PDF, Mehrfachauswahl möglich)" accept=".pdf" multiple onFiles={handleInvoiceFiles} />
            <ul className="file-list">
              {invoiceFiles.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  {f.name}{' '}
                  <button type="button" onClick={() => removeInvoiceFile(i)}>
                    entfernen
                  </button>
                </li>
              ))}
            </ul>
            <div className="step-actions">
              <button type="button" onClick={() => setStep(3)}>
                Zurück
              </button>
              <button type="button" disabled={invoiceFiles.length === 0} onClick={() => setStep(5)}>
                Weiter
              </button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section>
            <h2>5. Dateien analysieren</h2>
            <p>{invoiceFiles.length} Rechnung(en) für den Bezugsmonat {selectedMonth}-{selectedYear} bereit zur Analyse.</p>
            {analyzing && analyzeProgress && (
              <p>
                Analysiere… {analyzeProgress.done} / {analyzeProgress.total}
              </p>
            )}
            <div className="step-actions">
              <button type="button" onClick={() => setStep(4)} disabled={analyzing}>
                Zurück
              </button>
              <button type="button" onClick={handleAnalyze} disabled={analyzing}>
                Analyse starten
              </button>
            </div>
          </section>
        )}

        {step === 6 && (
          <section>
            <h2>6. Fehler und offene Zuordnungen bearbeiten</h2>
            <ReviewTable
              invoices={invoices}
              weightList={weightList}
              onEditPosition={handleEditPosition}
              onEditInvoice={handleEditInvoice}
              onConfirmProductMapping={handleConfirmProductMapping}
              onNegativeDecision={handleNegativeDecision}
            />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(5)}>
                Zurück
              </button>
              <button type="button" onClick={() => setStep(7)}>
                Weiter zur Vorschau
              </button>
            </div>
          </section>
        )}

        {step === 7 && (
          <section>
            <h2>7. Vorschau der Intrastat-Daten</h2>
            <PreviewTable invoices={invoices} />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(6)}>
                Zurück zur Prüfung
              </button>
              <button type="button" onClick={() => setStep(8)}>
                Weiter zum Export
              </button>
            </div>
          </section>
        )}

        {step === 8 && (
          <section>
            <h2>8. Excel-Datei exportieren</h2>
            <ExportSummaryView summary={summary} fileName={fileName} onDownload={handleExport} canExport={canExport} />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(7)}>
                Zurück
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
