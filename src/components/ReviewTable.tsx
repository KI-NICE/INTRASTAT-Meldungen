import { useState } from 'react'
import type { Invoice, InvoicePosition, ProductWeightEntry } from '../types'
import { listKnownCountries } from '../lib/countryCodes'
import { formatGermanNumber } from '../lib/germanNumber'

type ReviewTableProps = {
  invoices: Invoice[]
  weightList: ProductWeightEntry[]
  onEditPosition: (invoiceId: string, positionId: string, patch: Partial<InvoicePosition>, field: string) => void
  onEditInvoice: (invoiceId: string, patch: Partial<Invoice>, field: string) => void
  onConfirmProductMapping: (invoiceId: string, positionId: string, entry: ProductWeightEntry) => void
  onConfirmCountry: (invoiceId: string, isoCode: string) => void
  onNegativeDecision: (invoiceId: string, positionId: string, include: boolean) => void
}

const KNOWN_COUNTRIES = listKnownCountries()

const ADDRESS_KIND_LABEL: Record<string, string> = {
  delivery: 'Lieferadresse',
  order: 'Auftragsadresse',
  recipient: 'Empfängeradresse (Briefkopf)',
}

const COUNTRY_SOURCE_LABEL: Record<string, string> = {
  delivery: 'aus Lieferadresse',
  order: 'aus Auftragsadresse',
  recipient: 'Vorschlag aus Empfängeradresse',
  'gelernte-zuordnung': 'gelernte Zuordnung für diese Adresse',
  'gespeichertes-mapping': 'aus gespeicherter Kennzeichen-Zuordnung',
  manual: 'manuell bestätigt',
  unresolved: 'ungeklärt',
}

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
  onConfirmCountry,
  onNegativeDecision,
}: ReviewTableProps) {
  if (invoices.length === 0) {
    return <p>Es wurden noch keine Rechnungen analysiert.</p>
  }

  return (
    <div className="review">
      {invoices.map((invoice) => (
        <InvoiceCard
          key={invoice.id}
          invoice={invoice}
          weightList={weightList}
          onEditPosition={onEditPosition}
          onEditInvoice={onEditInvoice}
          onConfirmProductMapping={onConfirmProductMapping}
          onConfirmCountry={onConfirmCountry}
          onNegativeDecision={onNegativeDecision}
        />
      ))}
    </div>
  )
}

function InvoiceCard({
  invoice,
  weightList,
  onEditPosition,
  onEditInvoice,
  onConfirmProductMapping,
  onConfirmCountry,
  onNegativeDecision,
}: { invoice: Invoice } & Omit<ReviewTableProps, 'invoices'>) {
  const [showRawText, setShowRawText] = useState(false)

  const relevantPositions = invoice.positions.filter((p) => !p.isCreditOrDiscountOrNegative)
  const calculatedWeight = relevantPositions.reduce((sum, p) => sum + (p.calculatedWeightKgRounded ?? 0), 0)
  const weightDifference =
    invoice.netWeightTotal != null ? calculatedWeight - invoice.netWeightTotal : undefined

  const invoiceStatus: 'ok' | 'warning' | 'error' =
    invoice.status === 'error' ? 'error' : invoice.status === 'warning' ? 'warning' : 'ok'

  return (
    <section className={`invoice-card invoice-card--${invoiceStatus}`}>
      <header className="invoice-card__header">
        <div>
          <h3>
            {invoice.fileName} <StatusBadge status={invoiceStatus} />
          </h3>
          <p className="hint">
            Sprache: {invoice.language === 'en' ? 'englisch' : 'deutsch'}
            {invoice.ocrUsed ? ' · teilweise per Texterkennung (OCR) gelesen' : ''}
            {!invoice.hasFontInfo ? ' · kein Fettdruck erkennbar' : ''}
          </p>
        </div>
        <button type="button" onClick={() => setShowRawText((v) => !v)}>
          {showRawText ? 'Rohtext ausblenden' : 'Rohtext anzeigen'}
        </button>
      </header>

      <dl className="invoice-meta">
        <div>
          <dt>Rechnungsnummer</dt>
          <dd>
            <input
              value={invoice.invoiceNumber ?? ''}
              onChange={(e) => onEditInvoice(invoice.id, { invoiceNumber: e.target.value }, 'invoiceNumber')}
            />
          </dd>
        </div>
        <div>
          <dt>Rechnungsdatum (Feld „vom:“)</dt>
          <dd>
            <input
              value={invoice.invoiceDateRaw ?? ''}
              placeholder="TT.MM.JJJJ"
              onChange={(e) => onEditInvoice(invoice.id, { invoiceDateRaw: e.target.value }, 'invoiceDateRaw')}
            />
            <span className="hint">
              Bezugsmonat: {invoice.referenceMonth ?? '—'}-{invoice.referenceYear ?? '—'}
            </span>
          </dd>
        </div>
        <div>
          <dt>USt-IdNr. des Warenempfängers</dt>
          <dd>
            <input
              value={invoice.vatId ?? ''}
              onChange={(e) => onEditInvoice(invoice.id, { vatId: e.target.value.replace(/\s+/g, '') }, 'vatId')}
            />
          </dd>
        </div>
        <div>
          <dt>Bestimmungsland</dt>
          <dd>
            <select
              className={invoice.destinationCountry?.isManual ? 'edited' : ''}
              value={invoice.destinationCountry?.code ?? ''}
              onChange={(e) => onConfirmCountry(invoice.id, e.target.value)}
            >
              <option value="">– bitte auswählen –</option>
              {KNOWN_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} – {c.name}
                </option>
              ))}
            </select>
            <span className="hint">
              {COUNTRY_SOURCE_LABEL[invoice.destinationCountry?.source ?? 'unresolved']}
              {invoice.destinationCountry?.token ? ` · Kennzeichen „${invoice.destinationCountry.token}“` : ''}
            </span>
            {invoice.destinationCountry?.needsConfirmation && invoice.destinationCountry.code && (
              <button
                type="button"
                className="confirm-suggestion"
                onClick={() => onConfirmCountry(invoice.id, invoice.destinationCountry!.code!)}
              >
                Vorschlag „{invoice.destinationCountry.code}“ bestätigen und merken
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>Verwendete Adresse</dt>
          <dd>
            <strong>{ADDRESS_KIND_LABEL[invoice.usedAddress?.kind ?? ''] ?? 'keine erkannt'}</strong>
            <pre className="address">{invoice.usedAddress?.raw ?? '—'}</pre>
          </dd>
        </div>
        <div>
          <dt>Empfänger (Briefkopf)</dt>
          <dd>
            <pre className="address">{invoice.recipient?.raw ?? '—'}</pre>
          </dd>
        </div>
        <div>
          <dt>Netto-Gesamtgewicht laut Rechnung</dt>
          <dd>
            <input
              type="number"
              step="any"
              value={invoice.netWeightTotal ?? ''}
              onChange={(e) =>
                onEditInvoice(
                  invoice.id,
                  { netWeightTotal: e.target.value === '' ? undefined : Number(e.target.value) },
                  'netWeightTotal',
                )
              }
            />{' '}
            kg
          </dd>
        </div>
        <div>
          <dt>Berechnetes Gesamtgewicht</dt>
          <dd>
            {calculatedWeight} kg
            {weightDifference != null && (
              <span className={weightDifference === 0 ? 'hint' : 'hint hint--error'}>
                {' '}
                Differenz: {weightDifference > 0 ? '+' : ''}
                {weightDifference} kg
              </span>
            )}
          </dd>
        </div>
        {invoice.freightCost != null && (
          <div>
            <dt>Frachtkosten (anteilig auf Spalte N verteilt)</dt>
            <dd>{formatGermanNumber(invoice.freightCost, 2)} EUR</dd>
          </div>
        )}
      </dl>

      {invoice.issues.length > 0 && (
        <ul className="issue-list">
          {invoice.issues.map((issue) => (
            <li key={issue.id} className={`issue issue--${issue.severity}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="review-table-wrapper">
        <table className="review-table">
          <thead>
            <tr>
              <th>Pos.</th>
              <th>Zolltarifnummer</th>
              <th>Produktbezeichnung (Rechnung)</th>
              <th>Zugeordnetes Produkt (Gewichtsliste)</th>
              <th>Menge</th>
              <th>Einzelgewicht (g)</th>
              <th>Gesamtgewicht (kg)</th>
              <th>Positionsbetrag (EUR)</th>
              <th>Zuschlag stat. Wert</th>
              <th>Statist. Wert (EUR)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoice.positions.map((position) => (
              <tr
                key={position.id}
                className={
                  position.status === 'error' ? 'row--error' : position.status === 'warning' ? 'row--warning' : ''
                }
              >
                <td>
                  <strong>{position.positionNumber ?? position.lineNo}</strong>
                </td>
                <td>
                  <input
                    className={`code-input ${position.customsCode !== position.customsCodeRaw?.replace(/\D/g, '') ? 'edited' : ''}`}
                    value={position.customsCode ?? ''}
                    maxLength={8}
                    onChange={(e) =>
                      onEditPosition(
                        invoice.id,
                        position.id,
                        { customsCode: e.target.value.replace(/\D/g, '') },
                        'customsCode',
                      )
                    }
                  />
                </td>
                <td>
                  <textarea
                    className="product-input"
                    rows={2}
                    value={position.productNameRaw}
                    onChange={(e) =>
                      onEditPosition(invoice.id, position.id, { productNameRaw: e.target.value }, 'productNameRaw')
                    }
                  />
                </td>
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
                    step="any"
                    className="number-input"
                    value={position.quantity ?? ''}
                    onChange={(e) =>
                      onEditPosition(
                        invoice.id,
                        position.id,
                        { quantity: e.target.value === '' ? undefined : Number(e.target.value) },
                        'quantity',
                      )
                    }
                  />
                  <span className="hint">{position.quantityRaw ? `gelesen: ${position.quantityRaw} Stück` : ''}</span>
                </td>
                <td>{position.productMatch?.entry?.unitWeightGrams ?? '—'}</td>
                <td>{position.calculatedWeightKgRounded ?? '—'}</td>
                <td>
                  <input
                    type="number"
                    step="any"
                    className="number-input"
                    value={position.amountEur ?? ''}
                    onChange={(e) =>
                      onEditPosition(
                        invoice.id,
                        position.id,
                        { amountEur: e.target.value === '' ? undefined : Number(e.target.value) },
                        'amountEur',
                      )
                    }
                  />
                  <span className="hint">
                    {position.amountEurRounded != null ? `Spalte N: ${position.amountEurRounded}` : ''}
                  </span>
                </td>
                <td>
                  {position.statisticalSurchargeEurRaw != null
                    ? formatGermanNumber(position.statisticalSurchargeEurRaw, 2)
                    : '—'}
                </td>
                <td>{position.statisticalValueEurRounded ?? '—'}</td>
                <td>
                  <StatusBadge status={position.status} />
                  {position.isSpecialUnit && (
                    <span className="hint">Spalte M: {Math.round(position.quantity ?? 0)} Stück</span>
                  )}
                  {position.isCreditOrDiscountOrNegative && !position.negativeDecisionMade && (
                    <div className="negative-decision">
                      <p>
                        Gutschrift/Storno/Rabatt vermutet
                        {position.negativeReason ? ` („${position.negativeReason}“)` : ''} – bitte entscheiden:
                      </p>
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
            ))}
          </tbody>
        </table>
      </div>

      {showRawText && (
        <div className="raw-text">
          <p className="hint">
            Aus der PDF gelesener Text – hilfreich, wenn Felder nicht erkannt wurden. Verlässt den Browser nicht.
          </p>
          <pre>{invoice.rawText || '(kein Text gelesen)'}</pre>
        </div>
      )}
    </section>
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

  const match = position.productMatch

  if (match?.entry) {
    const typeLabel =
      match.matchType === 'exact'
        ? 'exakter Treffer'
        : match.matchType === 'normalized'
          ? 'normalisierter Treffer'
          : match.matchType === 'prefix'
            ? 'über Bezeichnungsanfang'
            : match.matchType === 'beschreibung'
              ? `Gewicht aus der Beschreibung (${match.entry.zusatz ?? ''}) – nicht über die Gewichtsliste`
              : 'manuell bestätigt'
    return (
      <div className={match.matchType === 'manual' ? 'edited product-mapping-cell' : 'product-mapping-cell'}>
        <strong>{match.entry.name}</strong>
        <span className="hint">{typeLabel}</span>
        <select
          defaultValue=""
          onChange={(e) => {
            const entry = weightList.find((w) => w.name === e.target.value)
            if (entry) onConfirm(entry)
          }}
        >
          <option value="" disabled>
            Zuordnung ändern…
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

  const suggestions = match?.suggestions ?? []

  return (
    <div className="product-mapping-cell">
      {suggestions.length > 0 ? (
        <>
          <span className="hint hint--error">Nicht eindeutig – bitte bestätigen:</span>
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
                {s.entry.name} ({s.entry.unitWeightGrams} g, {Math.round(s.score * 100)} %)
              </option>
            ))}
          </select>
        </>
      ) : (
        <span className="hint hint--error">Kein Treffer – bitte wählen:</span>
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
