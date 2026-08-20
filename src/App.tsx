import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { StepNav } from './components/StepNav'
import { FileDropzone } from './components/FileDropzone'
import { ReviewTable } from './components/ReviewTable'
import { PreviewTable } from './components/PreviewTable'
import { ExportSummaryView } from './components/ExportSummaryView'
import type { Invoice, InvoicePosition, ProductWeightEntry } from './types'
import { GEWICHTSLISTE } from './data/gewichtsliste'
import { parseWeightListDocx } from './lib/weightList'
import { loadBundledTemplate, createExportBuffer, buildExportFileName } from './lib/excelTemplate'
import { processInvoiceFile, recalculateInvoice } from './lib/processing'
import { deriveReferencePeriod } from './lib/invoiceParser'
import {
  saveManualMapping,
  normalizeProductName,
  saveCountryMapping,
  clearManualMappings,
  clearCountryMappings,
} from './lib/mappingStore'
import { summarizeInvoices } from './lib/calculations'

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const CURRENT_YEAR = 2026
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(String)

function App() {
  const [step, setStep] = useState(1)

  // Gewichtsliste und Mustertabelle sind fest hinterlegt.
  const [weightList, setWeightList] = useState<ProductWeightEntry[]>(GEWICHTSLISTE)
  const [weightListSource, setWeightListSource] = useState<'hinterlegt' | 'ersetzt'>('hinterlegt')
  const [templateStatus, setTemplateStatus] = useState<'lade' | 'ok' | 'fehler'>('lade')
  const [templateSheetName, setTemplateSheetName] = useState<string>('')
  const [templateError, setTemplateError] = useState<string | null>(null)

  const [selectedMonth, setSelectedMonth] = useState('08')
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR))

  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  const [sessionMappings, setSessionMappings] = useState<Record<string, ProductWeightEntry>>({})

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

  async function handleReplaceWeightList(files: File[]) {
    try {
      const entries = await parseWeightListDocx(files[0])
      if (entries.length === 0) {
        window.alert('In der Datei wurden keine Produkt-/Gewichtsangaben erkannt. Die hinterlegte Liste bleibt aktiv.')
        return
      }
      setWeightList(entries)
      setWeightListSource('ersetzt')
    } catch {
      window.alert('Die Gewichtsliste konnte nicht gelesen werden. Die hinterlegte Liste bleibt aktiv.')
    }
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

  async function handleAnalyze() {
    setAnalyzing(true)
    const results: Invoice[] = []
    for (const file of invoiceFiles) {
      setAnalyzeProgress({ done: results.length, total: invoiceFiles.length, current: file.name })
      const invoice = await processInvoiceFile(file, weightList, selectedMonth, selectedYear, sessionMappings)
      results.push(invoice)
    }
    setAnalyzeProgress({ done: results.length, total: invoiceFiles.length, current: '' })
    setInvoices(results)
    setAnalyzing(false)
    setStep(4)
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
        return next
      })
      return recalculateInvoice({ ...invoice, positions }, weightList, selectedMonth, selectedYear, sessionMappings)
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
      // Bezugsmonat folgt dem Rechnungsdatum.
      if (field === 'invoiceDateRaw') {
        const period = deriveReferencePeriod(updated.invoiceDateRaw)
        updated.referenceMonth = period?.month
        updated.referenceYear = period?.year
      }
      return recalculateInvoice(updated, weightList, selectedMonth, selectedYear, sessionMappings)
    })
  }

  /** Manuell bestätigtes Bestimmungsland – wird für künftige Läufe gespeichert. */
  function handleConfirmCountry(invoiceId: string, isoCode: string) {
    const invoice = invoices.find((inv) => inv.id === invoiceId)
    if (!invoice) return

    const token = invoice.destinationCountry?.token
    if (isoCode && token) {
      saveCountryMapping(token, isoCode)
    }

    updateInvoiceById(invoiceId, (inv) => {
      const updated: Invoice = {
        ...inv,
        destinationCountry: {
          code: isoCode || null,
          source: isoCode ? 'manual' : 'unresolved',
          isManual: true,
          token: inv.destinationCountry?.token ?? null,
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
      return recalculateInvoice(updated, weightList, selectedMonth, selectedYear, sessionMappings)
    })

    // Gleiches Token in anderen Rechnungen ebenfalls übernehmen.
    if (isoCode && token) {
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.id === invoiceId) return inv
          if (inv.destinationCountry?.code) return inv
          if (inv.destinationCountry?.token !== token) return inv
          const updated: Invoice = {
            ...inv,
            destinationCountry: {
              code: isoCode,
              source: 'gespeichertes-mapping',
              isManual: false,
              token,
            },
          }
          return recalculateInvoice(updated, weightList, selectedMonth, selectedYear, sessionMappings)
        }),
      )
    }
  }

  function handleConfirmProductMapping(invoiceId: string, positionId: string, entry: ProductWeightEntry) {
    const invoice = invoices.find((inv) => inv.id === invoiceId)
    const position = invoice?.positions.find((p) => p.id === positionId)
    if (!position) return

    saveManualMapping(position.productNameRaw, entry)
    const normalized = normalizeProductName(position.productNameRaw)
    const nextSessionMappings = { ...sessionMappings, [normalized]: entry }
    setSessionMappings(nextSessionMappings)

    // Auf alle identischen Produktbezeichnungen im aktuellen Durchlauf anwenden.
    setInvoices((prev) =>
      prev.map((inv) => {
        const affected = inv.positions.some((p) => normalizeProductName(p.productNameRaw) === normalized)
        if (!affected) return inv
        const positions = inv.positions.map((p) =>
          normalizeProductName(p.productNameRaw) === normalized
            ? { ...p, productMatch: { matchType: 'manual' as const, entry, suggestions: [] } }
            : p,
        )
        return recalculateInvoice(
          { ...inv, positions },
          weightList,
          selectedMonth,
          selectedYear,
          nextSessionMappings,
        )
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
      return recalculateInvoice({ ...invoice, positions }, weightList, selectedMonth, selectedYear, sessionMappings)
    })
  }

  const summary = useMemo(() => summarizeInvoices(invoices), [invoices])

  const canExport =
    templateStatus === 'ok' &&
    invoices.length > 0 &&
    summary.generatedRows > 0 &&
    invoices.every(
      (inv) =>
        !inv.issues.some((i) => i.severity === 'error') &&
        !inv.positions.some((p) => p.issues.some((i) => i.severity === 'error')),
    )

  async function handleExport() {
    try {
      const buffer = await createExportBuffer(invoices)
      const fileName = buildExportFileName(selectedMonth, selectedYear)
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

  const fileName = buildExportFileName(selectedMonth, selectedYear)

  return (
    <div className="app">
      <header className="app__header">
        <h1>Intrastat-Meldungen aus PDF-Rechnungen</h1>
        <p>Alle Dateien werden ausschließlich lokal im Browser verarbeitet.</p>
      </header>

      <section className="bundled-info">
        <div>
          <strong>Gewichtsliste:</strong> {weightList.length} Produkte{' '}
          {weightListSource === 'hinterlegt' ? 'fest hinterlegt' : 'aus ersetzter Datei (nur diese Sitzung)'}
        </div>
        <div>
          <strong>Mustertabelle:</strong>{' '}
          {templateStatus === 'ok'
            ? `fest hinterlegt (Arbeitsblatt „${templateSheetName}“)`
            : templateStatus === 'lade'
              ? 'wird geladen…'
              : `Fehler: ${templateError}`}
        </div>
        <details>
          <summary>Erweitert</summary>
          <div className="bundled-info__advanced">
            <FileDropzone
              label="Gewichtsliste vorübergehend ersetzen (optional)"
              accept=".docx"
              onFiles={handleReplaceWeightList}
              hint="Nur nötig, wenn sich Gewichte geändert haben. Gilt bis zum Neuladen der Seite."
            />
            <button
              type="button"
              onClick={() => {
                clearManualMappings()
                clearCountryMappings()
                setSessionMappings({})
                window.alert('Gespeicherte Produkt- und Länder-Zuordnungen wurden gelöscht.')
              }}
            >
              Gespeicherte Zuordnungen löschen
            </button>
          </div>
        </details>
      </section>

      <StepNav currentStep={step} onNavigate={setStep} />

      <main className="app__main">
        {step === 1 && (
          <section>
            <h2>1. Bezugsmonat auswählen</h2>
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
            <p className="hint">
              In Spalte B wird nur die zweistellige Monatszahl ({selectedMonth}) ausgegeben. Das Jahr dient der
              Plausibilitätsprüfung der Rechnungen und dem Dateinamen ({fileName}).
            </p>
            <div className="step-actions">
              <button type="button" onClick={() => setStep(2)}>
                Weiter
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>2. PDF-Rechnungen hochladen</h2>
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
              <button type="button" disabled={invoiceFiles.length === 0} onClick={() => setStep(3)}>
                Weiter
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <h2>3. Dateien analysieren</h2>
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
              <button type="button" onClick={handleAnalyze} disabled={analyzing}>
                Analyse starten
              </button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>4. Fehler und offene Zuordnungen bearbeiten</h2>
            <ReviewTable
              invoices={invoices}
              weightList={weightList}
              onEditPosition={handleEditPosition}
              onEditInvoice={handleEditInvoice}
              onConfirmProductMapping={handleConfirmProductMapping}
              onConfirmCountry={handleConfirmCountry}
              onNegativeDecision={handleNegativeDecision}
            />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(3)}>
                Zurück
              </button>
              <button type="button" onClick={() => setStep(5)}>
                Weiter zur Vorschau
              </button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section>
            <h2>5. Vorschau der Intrastat-Daten</h2>
            <PreviewTable invoices={invoices} />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(4)}>
                Zurück zur Prüfung
              </button>
              <button type="button" onClick={() => setStep(6)}>
                Weiter zum Export
              </button>
            </div>
          </section>
        )}

        {step === 6 && (
          <section>
            <h2>6. Excel-Datei exportieren</h2>
            <ExportSummaryView summary={summary} fileName={fileName} onDownload={handleExport} canExport={canExport} />
            <div className="step-actions">
              <button type="button" onClick={() => setStep(5)}>
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
