import type { Invoice } from '../types'
import { buildExportRow, getExportablePositions } from '../lib/excelTemplate'

const COLUMN_LABELS = [
  'A Richtung',
  'B Bezugsmonat',
  'C Art d. Geschäftes',
  'D Verkehrszweig',
  'E Versendungs-MS',
  'F Bestimmungs-MS',
  'G Bestimmungs-BL',
  'H Ursprungs-BL',
  'I Ursprungsland',
  'J Warennummer',
  'K Warenbezeichnung',
  'L Eigenmasse (kg)',
  'M Bes. Maßeinheit',
  'N Rechnungsbetrag (EUR)',
  'O Statist. Wert (EUR)',
  'P USt-IdNr.',
]

/**
 * Zeigt die Daten, die später in die Mustertabelle exportiert werden
 * (Spalten A–P) – je Rechnung nach Warennummer sortiert. Anders als der
 * tatsächliche Export zeigt diese Vorschau bewusst JEDE Position einzeln
 * (keine Zusammenfassung gleicher Warennummern), damit Fehler pro Position
 * erkennbar bleiben; im Excel-Export werden Positionen einer Rechnung mit
 * derselben Warennummer zu einer Zeile zusammengefasst.
 */
export function PreviewTable({ invoices }: { invoices: Invoice[] }) {
  const rows = invoices.flatMap((invoice) =>
    getExportablePositions(invoice).map((position) => ({ position, row: buildExportRow(invoice, position) })),
  )

  if (rows.length === 0) {
    return <p>Es liegen noch keine exportfähigen Zeilen vor.</p>
  }

  return (
    <div className="review-table-wrapper">
      <table className="review-table">
        <thead>
          <tr>
            {COLUMN_LABELS.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ position, row }) => (
            <tr key={position.id}>
              <td>{row.richtung}</td>
              <td>{row.bezugsmonat}</td>
              <td>{row.artDesGeschaeftes}</td>
              <td>{row.verkehrszweig}</td>
              <td>{row.versendungsMitgliedstaat || '—'}</td>
              <td>{row.bestimmungsMitgliedstaat || '—'}</td>
              <td>{row.bestimmungsBundesland || '—'}</td>
              <td>{row.ursprungsBundesland || '—'}</td>
              <td>{row.ursprungsland}</td>
              <td>{row.warennummer}</td>
              <td>{row.warenbezeichnung || '—'}</td>
              <td>{row.eigenmasseKg}</td>
              <td>{row.besondereMasseinheit === '' ? '—' : row.besondereMasseinheit}</td>
              <td>{row.rechnungsbetragEur}</td>
              <td>{row.statistischerWertEur === '' ? '—' : row.statistischerWertEur}</td>
              <td>{row.vatId || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="preview-note">
        Positionen einer Rechnung mit derselben Warennummer werden hier bewusst einzeln angezeigt; in der
        exportierten Excel-Datei werden sie zu einer Zeile zusammengefasst.
      </p>
    </div>
  )
}
