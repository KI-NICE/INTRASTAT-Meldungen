import type { Invoice } from '../types'
import { buildExportRow } from '../lib/excelTemplate'

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

/** Zeigt exakt die Daten, die später in die Mustertabelle exportiert werden (Spalten A–P). */
export function PreviewTable({ invoices }: { invoices: Invoice[] }) {
  const rows = invoices.flatMap((invoice) =>
    invoice.positions
      .filter((p) => !p.isCreditOrDiscountOrNegative)
      .map((position) => ({ position, row: buildExportRow(invoice, position) })),
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
              <td>{row.ursprungsBundesland}</td>
              <td>{row.ursprungsland}</td>
              <td>{row.warennummer}</td>
              <td>{row.warenbezeichnung || '—'}</td>
              <td>{row.eigenmasseKg}</td>
              <td>{row.besondereMasseinheit === '' ? '—' : row.besondereMasseinheit}</td>
              <td>{row.rechnungsbetragEur}</td>
              <td>{row.statistischerWertEur}</td>
              <td>{row.vatId}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="preview-note">
        Quelle je Zeile: {rows.length} Zeile(n) aus {invoices.length} Rechnung(en) – interne Hilfsdaten (z. B.
        Produktzuordnung, Konfidenzwerte) sind hier bewusst nicht enthalten und erscheinen auch nicht in der
        exportierten Excel-Datei.
      </p>
    </div>
  )
}
