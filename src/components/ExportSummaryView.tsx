import { formatGermanNumber } from '../lib/germanNumber'
import type { InvoiceDirection } from '../types'

export type ExportSummary = {
  processedInvoices: number
  generatedRows: number
  totalAmount: number
  totalNetWeightFromInvoices: number
  totalStatisticalValue: number
  manualCorrections: number
}

/**
 * `showStatisticalValue` ist nur bei Ausgangsrechnungen `true` – der
 * statistische Wert (Spalte O) wird ausschließlich dafür berechnet und
 * exportiert (siehe excelTemplate.ts), bei Eingangsrechnungen zeigt die
 * Zeile deshalb bewusst nur "–".
 */
function SummaryTable({ summary, showStatisticalValue }: { summary: ExportSummary; showStatisticalValue: boolean }) {
  return (
    <table className="export-summary__table">
      <tbody>
        <tr>
          <th>Anzahl verarbeiteter Rechnungen</th>
          <td>{summary.processedInvoices}</td>
        </tr>
        <tr>
          <th>Gesamtbetrag</th>
          <td>{formatGermanNumber(summary.totalAmount, 0)} EUR</td>
        </tr>
        <tr>
          <th>Gesamte Eigenmasse</th>
          <td>{formatGermanNumber(summary.totalNetWeightFromInvoices, 0)} kg</td>
        </tr>
        <tr>
          <th>Summe des statistischen Werts</th>
          <td>{showStatisticalValue ? `${formatGermanNumber(summary.totalStatisticalValue, 0)} EUR` : '–'}</td>
        </tr>
      </tbody>
    </table>
  )
}

/**
 * Zeigt die Export-Übersicht. Wurden sowohl Eingangs- als auch
 * Ausgangsrechnungen erfasst (`byDirection` gesetzt), erscheinen zwei Spalten
 * nebeneinander – links immer die Eingangs-, rechts die Ausgangsrechnungen,
 * je mit unterstrichenem Richtungs-Titel anstelle der generischen Schritt-
 * Überschrift. Wurde nur eine Richtung erfasst, bleibt die bisherige
 * einspaltige Ansicht ohne Richtungs-Titel bestehen.
 */
export function ExportSummaryView({
  summary,
  richtung,
  byDirection,
  fileName,
  onDownload,
  canExport,
}: {
  summary: ExportSummary
  /** Richtung der `summary` – bestimmt, ob "Summe des statistischen Werts" gezeigt wird. Nur relevant, wenn `byDirection` NICHT gesetzt ist. */
  richtung: InvoiceDirection
  /** Nur gesetzt, wenn BEIDE Richtungen erfasst wurden. */
  byDirection?: { eingang: ExportSummary; ausgang: ExportSummary }
  fileName: string
  onDownload: () => void
  canExport: boolean
}) {
  return (
    <div className="export-summary">
      {byDirection ? (
        <div className="export-summary__columns">
          <div className="export-summary__column">
            <h3 className="export-summary__column-title">Eingangsrechnungen</h3>
            <SummaryTable summary={byDirection.eingang} showStatisticalValue={false} />
          </div>
          <div className="export-summary__column">
            <h3 className="export-summary__column-title">Ausgangsrechnungen</h3>
            <SummaryTable summary={byDirection.ausgang} showStatisticalValue={true} />
          </div>
        </div>
      ) : (
        <SummaryTable summary={summary} showStatisticalValue={richtung === 'V'} />
      )}
      <button type="button" className="button--primary-solid" onClick={onDownload} disabled={!canExport}>
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
