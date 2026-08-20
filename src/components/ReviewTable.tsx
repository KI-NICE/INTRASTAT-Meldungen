import type { Invoice, InvoicePosition, ProductWeightEntry } from '../types'
import { listKnownCountries } from '../lib/countryCodes'
import { formatGermanNumber } from '../lib/germanNumber'

type ReviewTableProps = {
  invoices: Invoice[]
  weightList: ProductWeightEntry[]
  onEditPosition: (invoiceId: string, positionId: string, patch: Partial<InvoicePosition>, field: string) => void
  onEditInvoice: (invoiceId: string, patch: Partial<Invoice>, field: string) => void
  onConfirmProductMapping: (invoiceId: string, positionId: string, entry: ProductWeightEntry) => void
  onNegativeDecision: (invoiceId: string, positionId: string, include: boolean) => void
}

const KNOWN_COUNTRIES = listKnownCountries()

function StatusBadge({ status }: { status: 'ok' | 'warning' | 'error' }) {
  const label = status === 'ok' ? 'korrekt' : status === 'warning' ? 'Warnung' : 'Fehler'
  return <span className={`badge badge--${status}`}>{label}</span>
}

export function ReviewTable({
  invoices,
  weightList,
  onEditPosition,
  onEditInvoice,
  onConfirmProductMapping,
  onNegativeDecision,
}: ReviewTableProps) {
  if (invoices.length === 0) {
    return <p>Es wurden noch keine Rechnungen analysiert.</p>
  }

  return (
    <div className="review-table-wrapper">
      <table className="review-table">
        <thead>
          <tr>
            <th>Datei</th>
            <th>Rechnungs-Nr.</th>
            <th>Rechnungsdatum</th>
            <th>Empfänger</th>
            <th>Verwendete Lieferadresse</th>
            <th>Bestimmungsland</th>
            <th>USt-IdNr.</th>
            <th>Zolltarifnummer</th>
            <th>Produkt (Rechnung)</th>
            <th>Produkt (Gewichtsliste)</th>
            <th>Menge</th>
            <th>Einzelgewicht (g)</th>
            <th>Gesamtgewicht (kg)</th>
            <th>Positionsbetrag (EUR)</th>
            <th>Zuschlag stat. Wert (EUR)</th>
            <th>Statistischer Wert (EUR)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) =>
            invoice.positions.map((position, posIndex) => (
              <tr key={position.id} className={position.status === 'error' ? 'row--error' : position.status === 'warning' ? 'row--warning' : ''}>
                {posIndex === 0 && (
                  <>
                    <td rowSpan={invoice.positions.length}>{invoice.fileName}</td>
                    <td rowSpan={invoice.positions.length}>{invoice.invoiceNumber ?? '—'}</td>
                    <td rowSpan={invoice.positions.length}>{invoice.invoiceDateRaw ?? '—'}</td>
                    <td rowSpan={invoice.positions.length}>{invoice.recipient?.raw ?? '—'}</td>
                    <td rowSpan={invoice.positions.length}>{invoice.deliveryAddress?.raw ?? 'keine (Empfängeradresse verwendet)'}</td>
                    <td rowSpan={invoice.positions.length}>
                      <select
                        className={invoice.destinationCountry?.isManual ? 'edited' : ''}
                        value={invoice.destinationCountry?.code ?? ''}
                        onChange={(e) =>
                          onEditInvoice(
                            invoice.id,
                            {
                              destinationCountry: {
                                code: e.target.value || null,
                                source: 'manual',
                                isManual: true,
                              },
                            },
                            'destinationCountry',
                          )
                        }
                      >
                        <option value="">– auswählen –</option>
                        {KNOWN_COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} – {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td rowSpan={invoice.positions.length}>
                      <input
                        className={invoice.vatId !== invoice.vatIdRaw ? 'edited' : ''}
                        value={invoice.vatId ?? ''}
                        onChange={(e) => onEditInvoice(invoice.id, { vatId: e.target.value.replace(/\s+/g, '') }, 'vatId')}
                      />
                    </td>
                  </>
                )}
                <td>
                  <input
                    className={position.customsCode !== position.customsCodeRaw ? 'edited' : ''}
                    value={position.customsCode ?? ''}
                    maxLength={8}
                    onChange={(e) =>
                      onEditPosition(invoice.id, position.id, { customsCode: e.target.value.replace(/\D/g, '') }, 'customsCode')
                    }
                  />
                </td>
                <td>{position.productNameRaw}</td>
                <td>
                  <ProductMappingCell
                    position={position}
                    weightList={weightList}
                    onConfirm={(entry) => onConfirmProductMapping(invoice.id, position.id, entry)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className={String(position.quantity ?? '') !== (position.quantityRaw ?? '') ? 'edited' : ''}
                    value={position.quantity ?? ''}
                    onChange={(e) =>
                      onEditPosition(invoice.id, position.id, { quantity: e.target.value === '' ? undefined : Number(e.target.value) }, 'quantity')
                    }
                  />
                </td>
                <td>{position.productMatch?.entry?.unitWeightGrams ?? '—'}</td>
                <td>{position.calculatedWeightKgRounded ?? '—'}</td>
                <td>{position.amountEurRounded != null ? formatGermanNumber(position.amountEurRounded, 0) : '—'}</td>
                <td>
                  {position.statisticalSurchargeEurRaw != null ? formatGermanNumber(position.statisticalSurchargeEurRaw, 2) : '—'}
                </td>
                <td>{position.statisticalValueEurRounded != null ? formatGermanNumber(position.statisticalValueEurRounded, 0) : '—'}</td>
                <td>
                  <StatusBadge status={position.status} />
                  {position.isCreditOrDiscountOrNegative && !position.negativeDecisionMade && (
                    <div className="negative-decision">
                      <p>Gutschrift/Storno/Rabatt/negativer Betrag vermutet – bitte entscheiden:</p>
                      <button type="button" onClick={() => onNegativeDecision(invoice.id, position.id, false)}>
                        Ausschließen
                      </button>
                      <button type="button" onClick={() => onNegativeDecision(invoice.id, position.id, true)}>
                        Als normale Position übernehmen
                      </button>
                    </div>
                  )}
                  {position.issues.length > 0 && (
                    <ul className="issue-list">
                      {position.issues.map((issue) => (
                        <li key={issue.id} className={`issue issue--${issue.severity}`}>
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>

      {invoices.map(
        (invoice) =>
          invoice.issues.length > 0 && (
            <div key={`${invoice.id}-issues`} className="invoice-issues">
              <strong>{invoice.fileName}:</strong>
              <ul className="issue-list">
                {invoice.issues.map((issue) => (
                  <li key={issue.id} className={`issue issue--${issue.severity}`}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  )
}

function ProductMappingCell({
  position,
  weightList,
  onConfirm,
}: {
  position: InvoicePosition
  weightList: ProductWeightEntry[]
  onConfirm: (entry: ProductWeightEntry) => void
}) {
  if (position.isCreditOrDiscountOrNegative) return <span>—</span>

  if (position.productMatch?.entry) {
    const type = position.productMatch.matchType
    return (
      <span className={type === 'manual' ? 'edited' : ''}>
        {position.productMatch.entry.name}
        {type === 'manual' && ' (manuell bestätigt)'}
      </span>
    )
  }

  const suggestions = position.productMatch?.suggestions ?? []

  return (
    <div className="product-mapping-cell">
      {suggestions.length > 0 ? (
        <>
          <p>Vorschläge – niemals automatisch übernommen:</p>
          <select
            defaultValue=""
            onChange={(e) => {
              const entry = weightList.find((w) => w.name === e.target.value)
              if (entry) onConfirm(entry)
            }}
          >
            <option value="" disabled>
              Vorschlag auswählen…
            </option>
            {suggestions.map((s) => (
              <option key={s.entry.name} value={s.entry.name}>
                {s.entry.name} ({Math.round(s.score * 100)} % Ähnlichkeit)
              </option>
            ))}
          </select>
        </>
      ) : (
        <p>Kein Vorschlag – bitte manuell wählen:</p>
      )}
      <select
        defaultValue=""
        onChange={(e) => {
          const entry = weightList.find((w) => w.name === e.target.value)
          if (entry) onConfirm(entry)
        }}
      >
        <option value="" disabled>
          Aus Gewichtsliste wählen…
        </option>
        {weightList.map((w) => (
          <option key={w.name} value={w.name}>
            {w.name} ({w.unitWeightGrams} g)
          </option>
        ))}
      </select>
    </div>
  )
}
