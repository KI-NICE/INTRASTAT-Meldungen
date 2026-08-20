import { formatGermanNumber } from '../lib/germanNumber'

export type ExportSummary = {
  processedInvoices: number
  generatedRows: number
  totalAmount: number
  totalWeight: number
  totalStatisticalValue: number
  manualCorrections: number
}

export function ExportSummaryView({
  summary,
  fileName,
  onDownload,
  canExport,
}: {
  summary: ExportSummary
  fileName: string
  onDownload: () => void
  canExport: boolean
}) {
  return (
    <div className="export-summary">
      <ul>
        <li>Anzahl verarbeiteter Rechnungen: {summary.processedInvoices}</li>
        <li>Anzahl erzeugter Meldezeilen: {summary.generatedRows}</li>
        <li>Gesamtbetrag: {formatGermanNumber(summary.totalAmount, 0)} EUR</li>
        <li>Gesamte Eigenmasse: {formatGermanNumber(summary.totalWeight, 0)} kg</li>
        <li>Summe des statistischen Werts: {formatGermanNumber(summary.totalStatisticalValue, 0)} EUR</li>
        <li>Anzahl manueller Korrekturen: {summary.manualCorrections}</li>
      </ul>
      <button type="button" onClick={onDownload} disabled={!canExport}>
        {fileName} herunterladen
      </button>
      {!canExport && (
        <p className="export-summary__blocked">
          Export erst möglich, wenn alle Rechnungen ohne offene Fehler sind.
        </p>
      )}
    </div>
  )
}
