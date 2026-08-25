import { useState } from 'react'
import type { Invoice, InvoicePosition, ProductWeightEntry } from '../types'
import { listKnownCountries } from '../lib/countryCodes'
import { formatGermanNumber, parseGermanNumber } from '../lib/germanNumber'

type ReviewTableProps = {
  invoices: Invoice[]
  retryingId: string | null
  onEditPosition: (invoiceId: string, positionId: string, patch: Partial<InvoicePosition>, field: string) => void
  onEditInvoice: (invoiceId: string, patch: Partial<Invoice>, field: string) => void
  onConfirmProductMapping: (invoiceId: string, positionId: string, entry: ProductWeightEntry) => void
  onConfirmCountry: (invoiceId: string, isoCode: string) => void
  onNegativeDecision: (invoiceId: string, positionId: string, include: boolean) => void
  onRetryInvoice: (invoiceId: string) => void
  onAddPosition: (invoiceId: string) => void
  onRemovePosition: (invoiceId: string, positionId: string) => void
  onAcceptWeightTolerance: (invoiceId: string) => void
  onRemoveInvoice: (invoiceId: string) => void
}

const KNOWN_COUNTRIES = listKnownCountries()

const ADDRESS_KIND_LABEL: Record<string, string> = {
  lieferadresse: 'Lieferadresse',
  auftragsadresse: 'Auftragsadresse',
  empfaengeradresse: 'Empfängeradresse (Briefkopf)',
  versandanschrift: 'Versandanschrift',
}

const COUNTRY_SOURCE_LABEL: Record<string, string> = {
  ai: '',
  'gelernte-zuordnung': 'gelernte Zuordnung für diese Adresse',
  manual: 'manuell bestätigt',
  'vat-id-override': 'anhand USt-IdNr. korrigiert',
  unresolved: 'ungeklärt',
}

/** Reine Positionswerte (ohne Gutschrift/Storno/Rabatt, Frachtkosten/Zuschlag, MTZ). */
function getCalculatedWeight(invoice: Invoice): number {
  return invoice.positions
    .filter((p) => !p.isCreditOrDiscountOrNegative && !p.isTransportCost && !p.isMtzSurcharge)
    .reduce((sum, p) => sum + (p.calculatedWeightKgRounded ?? 0), 0)
}

function getWeightDifference(invoice: Invoice): number | undefined {
  return invoice.netWeightTotal != null ? getCalculatedWeight(invoice) - invoice.netWeightTotal : undefined
}

// Abweichungen von 1-2 kg gelten als unkritisch (orange), erst darüber als
// Fehler (rot) – siehe validation.ts für die zugehörige Sperrlogik.
function getToleranceSeverity(weightDifference: number | undefined): 'ok' | 'warning' | 'error' {
  return weightDifference == null || weightDifference === 0 ? 'ok' : Math.abs(weightDifference) <= 2 ? 'warning' : 'error'
}

function getInvoiceStatus(invoice: Invoice): 'ok' | 'warning' | 'error' {
  return invoice.status === 'error' ? 'error' : invoice.status === 'warning' ? 'warning' : 'ok'
}

// Zeigt statt des generischen Status ein spezifisches Badge: eine Differenz
// von 1-2 kg gilt automatisch als unkritisch ("Toleranz < 2 kg"), eine
// größere Differenz erst nach manueller Bestätigung ("Manuell bestätigt").
// Liegt DANEBEN noch ein echter Fehler vor (z. B. fehlendes Bestimmungsland),
// hat "Fehler" Vorrang – die Toleranz-Badges sollen ein anderes Problem nie
// verdecken.
function getBadgeOverrideLabel(invoice: Invoice, toleranceSeverity: 'ok' | 'warning' | 'error'): string | undefined {
  const invoiceStatus = getInvoiceStatus(invoice)
  if (invoiceStatus === 'error') return undefined
  if (toleranceSeverity === 'warning') return 'Toleranz < 2 kg'
  if (invoice.weightToleranceAccepted && toleranceSeverity === 'error') return 'Manuell bestätigt'
  return undefined
}

/**
 * Rechnungen ohne offenen Klärungsbedarf ("korrekt") werden in der
 * Prüfansicht beim ersten Erscheinen standardmäßig eingeklappt/ausgeblendet
 * (siehe ReviewTable) – eine frisch analysierte Rechnung hat zu diesem
 * Zeitpunkt naturgemäß noch keine manuell bestätigte Toleranz (siehe dort für
 * den separaten Auslöser, der eine Rechnung nachträglich ausblendet).
 */
function isHideableInvoice(invoice: Invoice): boolean {
  if (invoice.ai?.status === 'fehler') return false
  return getInvoiceStatus(invoice) === 'ok'
}

function StatusBadge({
  status,
  overrideLabel,
}: {
  status: 'ok' | 'warning' | 'error'
  /** Zeigt statt des generischen Status-Labels z. B. "Manuell bestätigt" oder "Toleranz < 2 kg" (gleiche Optik wie "Warnung"). */
  overrideLabel?: string
}) {
  if (overrideLabel) {
    return <span className="badge badge--warning">{overrideLabel}</span>
  }
  const label = status === 'ok' ? 'korrekt' : status === 'warning' ? 'Warnung' : 'Fehler'
  return <span className={`badge badge--${status}`}>{label}</span>
}

const STATUS_FILTER_LABEL: Record<'error' | 'warning' | 'ok', string> = {
  error: 'Fehler',
  warning: 'Toleranz',
  ok: 'korrekt',
}

export function ReviewTable({
  invoices,
  retryingId,
  onEditPosition,
  onEditInvoice,
  onConfirmProductMapping,
  onConfirmCountry,
  onNegativeDecision,
  onRetryInvoice,
  onAddPosition,
  onRemovePosition,
  onAcceptWeightTolerance,
  onRemoveInvoice,
}: ReviewTableProps) {
  const [searchQuery, setSearchQuery] = useState('')
  // Standardmäßig sind Rechnungen mit offenem Klärungsbedarf sichtbar
  // ("Fehler"/"kein Fehler"), rein "korrekte" dagegen ausgeblendet – deckt
  // sich mit dem früheren Ausblenden-Standard, ist aber jetzt ein direkt
  // sichtbarer, manuell umschaltbarer Filter statt eines automatischen
  // Verhaltens.
  const [statusFilter, setStatusFilter] = useState<Record<'error' | 'warning' | 'ok', boolean>>({
    error: true,
    warning: true,
    ok: false,
  })
  // Je Rechnung drei fest hinterlegte Werte: "collapsed" (Anzeige der Karte –
  // manuell über das Dreieck umschaltbar), "sortWeight" (Position in der
  // Liste) und "hidden" (vom Statusfilter "korrekt" betroffen). Alle drei
  // werden beim ersten Erscheinen einer Rechnung aus isHideableInvoice
  // bestimmt und danach NIE automatisch aus dem laufenden Status
  // nachgezogen – weder beim Bearbeiten noch beim Verlassen eines Felds. So
  // springt eine gerade bearbeitete Rechnung nicht plötzlich in der Liste
  // herum, klappt nicht von selbst zu und verschwindet nicht von selbst,
  // auch wenn sie durch die Bearbeitung auf "korrekt" wechselt – das
  // Zuklappen bleibt ausschließlich eine manuelle Aktion über das Dreieck.
  // "hidden" wird EINZIG durch die explizite Bestätigung einer Toleranz
  // (siehe markToleranceConfirmed) nachträglich auf true gesetzt.
  const [cardStates, setCardStates] = useState<
    Record<string, { collapsed: boolean; sortWeight: number; hidden: boolean }>
  >({})

  // Bootstrapt den Standard für neu auftauchende Rechnungen WÄHREND des
  // Renderns (React-Pattern zum Ableiten von State aus Props ohne Effekt) –
  // vermeidet einen zusätzlichen Effekt-Durchlauf für etwas, das direkt beim
  // Rendern feststeht.
  const newInvoices = invoices.filter((inv) => !(inv.id in cardStates))
  if (newInvoices.length > 0) {
    setCardStates((prev) => {
      const next = { ...prev }
      for (const invoice of newInvoices) {
        const hideable = isHideableInvoice(invoice)
        next[invoice.id] = { collapsed: hideable, sortWeight: hideable ? 1 : 0, hidden: hideable }
      }
      return next
    })
  }

  if (invoices.length === 0) {
    return <p>Es wurden noch keine Rechnungen analysiert.</p>
  }

  function getCardState(invoice: Invoice): { collapsed: boolean; sortWeight: number; hidden: boolean } {
    const hideable = isHideableInvoice(invoice)
    return cardStates[invoice.id] ?? { collapsed: hideable, sortWeight: hideable ? 1 : 0, hidden: hideable }
  }

  function toggleCollapsed(invoice: Invoice) {
    setCardStates((prev) => ({
      ...prev,
      [invoice.id]: { ...getCardState(invoice), collapsed: !getCardState(invoice).collapsed },
    }))
  }

  /**
   * Wird EINZIG beim expliziten Klick auf "Toleranz bestätigen" aufgerufen
   * (siehe onAcceptWeightTolerance unten) – klappt die Rechnung zu und
   * blendet sie zusammen mit den anderen "korrekten" Rechnungen aus, weil
   * hier bewusst eine Entscheidung getroffen wurde. Eine Rechnung, die nur
   * durch eine Feldänderung (z. B. korrigiertes Gewicht) auf "korrekt"
   * wechselt, bleibt davon unberührt (siehe passesStatusFilter).
   */
  function markToleranceConfirmed(invoiceId: string, invoice: Invoice) {
    setCardStates((prev) => ({ ...prev, [invoiceId]: { ...getCardState(invoice), collapsed: true, hidden: true } }))
  }

  // Eine Rechnung, die durch "hidden" (siehe oben) bewusst ausgeblendet
  // wurde, folgt dem "korrekt"-Filter. Eine Rechnung, die nur LIVE (noch
  // nicht bewusst ausgeblendet) auf "korrekt" steht – etwa weil gerade ein
  // Gewicht passend korrigiert wurde –, bleibt dagegen IMMER sichtbar, bis
  // sie manuell zugeklappt bzw. eine Toleranz bestätigt wurde; sie darf nicht
  // einfach aus der Liste verschwinden.
  function passesStatusFilter(invoice: Invoice): boolean {
    if (getCardState(invoice).hidden) return statusFilter.ok
    const status = getInvoiceStatus(invoice)
    if (status === 'ok') return true
    return statusFilter[status]
  }

  const statusCounts = { error: 0, warning: 0, ok: 0 }
  for (const invoice of invoices) statusCounts[getInvoiceStatus(invoice)]++

  const query = searchQuery.trim().toLowerCase()
  const visibleInvoices = query
    ? invoices.filter((inv) => (inv.invoiceNumber ?? '').toLowerCase().includes(query))
    : invoices.filter(passesStatusFilter)

  // Reihenfolge bleibt über die gesamte Bearbeitung fix (sortWeight wird
  // einmalig beim Bootstrap vergeben, siehe oben) – Auf-/Zuklappen einer
  // Rechnung verändert ihre Position in der Liste nicht mehr.
  const sortedInvoices = [...visibleInvoices].sort((a, b) => getCardState(a).sortWeight - getCardState(b).sortWeight)

  return (
    <div className="review">
      <div className="review__toolbar">
        <input
          type="text"
          className="review__search"
          placeholder="Nach Rechnungsnummer suchen…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="review__status-filter">
          {(['error', 'warning', 'ok'] as const).map((status) => (
            <label key={status} className="review__status-filter-option">
              <input
                type="checkbox"
                checked={statusFilter[status]}
                onChange={(e) => setStatusFilter((prev) => ({ ...prev, [status]: e.target.checked }))}
              />
              {STATUS_FILTER_LABEL[status]} ({statusCounts[status]})
            </label>
          ))}
        </div>
      </div>
      {sortedInvoices.map((invoice) => (
        <InvoiceCard
          key={invoice.id}
          invoice={invoice}
          collapsed={getCardState(invoice).collapsed}
          onToggleCollapse={() => toggleCollapsed(invoice)}
          retryingId={retryingId}
          onEditPosition={onEditPosition}
          onEditInvoice={onEditInvoice}
          onConfirmProductMapping={onConfirmProductMapping}
          onConfirmCountry={onConfirmCountry}
          onNegativeDecision={onNegativeDecision}
          onRetryInvoice={onRetryInvoice}
          onAddPosition={onAddPosition}
          onRemovePosition={onRemovePosition}
          onAcceptWeightTolerance={(invoiceId) => {
            onAcceptWeightTolerance(invoiceId)
            markToleranceConfirmed(invoiceId, invoice)
          }}
          onRemoveInvoice={onRemoveInvoice}
        />
      ))}
    </div>
  )
}

function InvoiceCard({
  invoice,
  collapsed,
  onToggleCollapse,
  retryingId,
  onEditPosition,
  onEditInvoice,
  onConfirmProductMapping,
  onConfirmCountry,
  onNegativeDecision,
  onRetryInvoice,
  onAddPosition,
  onRemovePosition,
  onAcceptWeightTolerance,
  onRemoveInvoice,
}: {
  invoice: Invoice
  collapsed: boolean
  onToggleCollapse: () => void
} & Omit<ReviewTableProps, 'invoices'>) {
  const calculatedWeight = getCalculatedWeight(invoice)
  const transportCostPositions = invoice.positions.filter((p) => p.isTransportCost)
  const transportCostSum = transportCostPositions.reduce((sum, p) => sum + (p.amountEur ?? 0), 0)
  // Gibt es Frachtkosten-/Zuschlagspositionen, ist deren Summe maßgeblich –
  // ein zusätzlich im Kopf ausgewiesener Betrag wird nicht addiert (siehe
  // processing.ts, damit hier derselbe Betrag wie in Spalte N angezeigt wird).
  const effectiveFreightCost = transportCostSum > 0 ? transportCostSum : invoice.freightCost ?? 0
  const weightDifference = getWeightDifference(invoice)
  const toleranceSeverity = getToleranceSeverity(weightDifference)
  const invoiceStatus = getInvoiceStatus(invoice)
  const badgeOverrideLabel = getBadgeOverrideLabel(invoice, toleranceSeverity)

  if (invoice.ai?.status === 'fehler') {
    return (
      <section className="invoice-card invoice-card--error">
        <header className="invoice-card__header">
          <h3>
            {invoice.fileName} <StatusBadge status="error" />
          </h3>
          <button type="button" className="remove-invoice" onClick={() => onRemoveInvoice(invoice.id)}>
            Rechnung entfernen
          </button>
        </header>
        <div className="ai-panel ai-panel--error">
          <strong>Claude konnte diese Rechnung nicht auslesen.</strong> {invoice.ai.error}
          <div className="step-actions">
            <button
              type="button"
              disabled={retryingId === invoice.id}
              onClick={() => onRetryInvoice(invoice.id)}
            >
              {retryingId === invoice.id ? 'Wird erneut ausgelesen…' : 'Erneut versuchen'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="invoice-card-row">
      <button
        type="button"
        className="invoice-card__toggle"
        aria-label={collapsed ? 'Rechnung aufklappen' : 'Rechnung einklappen'}
        aria-expanded={!collapsed}
        onClick={onToggleCollapse}
      >
        <span className={`invoice-card__triangle invoice-card__triangle--${collapsed ? 'down' : 'up'}`} />
      </button>
      <section
        className={`invoice-card invoice-card--${invoiceStatus}${collapsed ? ' invoice-card--collapsed' : ''}`}
      >
        {collapsed ? (
          <header className="invoice-card__header invoice-card__header--collapsed">
            <h3>{invoice.fileName}</h3>
            <StatusBadge status={invoiceStatus} overrideLabel={badgeOverrideLabel} />
          </header>
        ) : (
          <header className="invoice-card__header">
            <div>
              <h3>
                {invoice.fileName} <StatusBadge status={invoiceStatus} overrideLabel={badgeOverrideLabel} />
              </h3>
              <p className="hint">
                {invoice.richtung === 'V' ? 'Ausgangsrechnung' : 'Eingangsrechnung'}
                {!invoice.isManualEntry ? ` · Sprache: ${invoice.language === 'en' ? 'englisch' : 'deutsch'}` : ' · manuell erfasst'}
              </p>
            </div>
            <button
              type="button"
              className="remove-invoice"
              onClick={() => {
                if (
                  invoice.isManualEntry ||
                  window.confirm(
                    `Soll die Rechnung „${invoice.fileName}“ wirklich entfernt werden? Sie müsste andernfalls erneut hochgeladen und von Claude ausgelesen werden.`,
                  )
                ) {
                  onRemoveInvoice(invoice.id)
                }
              }}
            >
              Rechnung entfernen
            </button>
          </header>
        )}

        {!collapsed && (
          <>
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
          <dt>Rechnungsdatum</dt>
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
        {invoice.richtung === 'V' && (
          <div>
            <dt>USt-IdNr. des Warenempfängers</dt>
            <dd>
              <input
                value={invoice.vatId ?? ''}
                onChange={(e) => onEditInvoice(invoice.id, { vatId: e.target.value.replace(/\s+/g, '') }, 'vatId')}
              />
            </dd>
          </div>
        )}
        {invoice.richtung === 'V' && (
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
              {COUNTRY_SOURCE_LABEL[invoice.destinationCountry?.source ?? 'unresolved'] && (
                <span className="hint">{COUNTRY_SOURCE_LABEL[invoice.destinationCountry?.source ?? 'unresolved']}</span>
              )}
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
        )}
        {invoice.richtung === 'E' && (
          <>
            <div>
              <dt>Versendungsmitgliedstaat</dt>
              <dd>
                <select
                  className={invoice.versendungsMitgliedstaat ? '' : 'hint--error'}
                  value={invoice.versendungsMitgliedstaat ?? ''}
                  onChange={(e) =>
                    onEditInvoice(invoice.id, { versendungsMitgliedstaat: e.target.value }, 'versendungsMitgliedstaat')
                  }
                >
                  <option value="">– bitte auswählen –</option>
                  {KNOWN_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} – {c.name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Ursprungsland</dt>
              <dd>
                <select
                  className={invoice.ursprungsland ? '' : 'hint--error'}
                  value={invoice.ursprungsland ?? ''}
                  onChange={(e) => onEditInvoice(invoice.id, { ursprungsland: e.target.value }, 'ursprungsland')}
                >
                  <option value="">– bitte auswählen –</option>
                  {KNOWN_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} – {c.name}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Verwendete Adresse</dt>
          <dd>
            <strong>{ADDRESS_KIND_LABEL[invoice.destinationAddressKind ?? ''] ?? 'keine erkannt'}</strong>
            <pre className="address">{invoice.destinationAddressText ?? '—'}</pre>
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
            {formatGermanNumber(calculatedWeight, 0)} kg
            {weightDifference != null && (
              <span
                className={`hint${toleranceSeverity === 'error' ? ' hint--error' : toleranceSeverity === 'warning' ? ' hint--warning' : ''}`}
              >
                {' '}
                Differenz: {weightDifference > 0 ? '+' : ''}
                {formatGermanNumber(weightDifference, 0)} kg
              </span>
            )}
            {weightDifference != null && weightDifference !== 0 && (
              <button
                type="button"
                className={invoice.weightToleranceAccepted ? 'confirm-suggestion edited' : 'confirm-suggestion'}
                onClick={() => onAcceptWeightTolerance(invoice.id)}
              >
                {invoice.weightToleranceAccepted ? 'Toleranz bestätigt ✓' : 'Toleranz bestätigen'}
              </button>
            )}
          </dd>
        </div>
        {(invoice.freightCost != null || transportCostSum > 0) && (
          <div>
            <dt>Frachtkosten/Zuschläge (anteilig auf Spalte N verteilt)</dt>
            <dd>
              {formatGermanNumber(effectiveFreightCost, 2)} EUR
              <span className="hint">
                {' '}
                {transportCostSum > 0
                  ? `aus Position(en) (Art. ${transportCostPositions.map((p) => p.articleNumberRaw).join(', ')})`
                  : 'aus der Kopf-Angabe der Rechnung'}
              </span>
              {transportCostSum > 0 && invoice.freightCost != null && invoice.freightCost !== transportCostSum && (
                <span className="hint hint--error">
                  {' '}
                  Zusätzlich im Kopf ausgewiesen: {formatGermanNumber(invoice.freightCost, 2)} EUR – wird nicht
                  addiert, um die Frachtkosten nicht doppelt umzulegen. Bitte prüfen, welcher Betrag zutrifft.
                </span>
              )}
            </dd>
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

      {invoice.ai && invoice.ai.uncertainFields.length > 0 && (
        <div className="ai-panel ai-panel--open">
          <strong>Von Claude als unsicher gemeldet:</strong> {invoice.ai.uncertainFields.join(', ')}
        </div>
      )}

      <div className="review-table-wrapper">
        <table className="review-table">
          <thead>
            <tr>
              <th>Pos.</th>
              <th>Artikelnummer</th>
              <th>Artikelbeschreibung</th>
              <th>Zolltarif-Nr.</th>
              <th>Menge</th>
              <th>Einzelgewicht (g)</th>
              <th>Gesamtgewicht (kg)</th>
              <th>Positionsbetrag (EUR)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoice.positions.map((position) => (
              <tr
                key={position.id}
                className={
                  position.isTransportCost || position.isMtzSurcharge
                    ? 'row--transport'
                    : position.status === 'error'
                      ? 'row--error'
                      : position.status === 'warning'
                        ? 'row--warning'
                        : ''
                }
              >
                <td>
                  <strong>{position.positionNumber ?? position.lineNo}</strong>
                </td>
                <td>
                  <input
                    className="code-input"
                    placeholder="Artikelnummer"
                    value={position.articleNumberRaw ?? ''}
                    onChange={(e) =>
                      onEditPosition(
                        invoice.id,
                        position.id,
                        { articleNumberRaw: e.target.value.trim() || undefined },
                        'articleNumberRaw',
                      )
                    }
                  />
                  <ProductMappingCell position={position} />
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
                  {position.mtzSurchargeEurRaw != null && (
                    <span className="hint">
                      inkl. Materialteuerungszuschlag: {formatGermanNumber(position.mtzSurchargeEurRaw, 2)} EUR
                    </span>
                  )}
                </td>
                <td>
                  {position.isCreditOrDiscountOrNegative || position.isTransportCost || position.isMtzSurcharge ? (
                    '—'
                  ) : (
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
                  )}
                </td>
                <td>
                  <FormattedNumberInput
                    value={position.quantity}
                    decimals={0}
                    className="number-input"
                    onCommit={(v) => onEditPosition(invoice.id, position.id, { quantity: v }, 'quantity')}
                  />
                </td>
                <td>
                  {position.isCreditOrDiscountOrNegative || position.isTransportCost || position.isMtzSurcharge ? (
                    '—'
                  ) : (
                    <ManualWeightEntry
                      position={position}
                      initialValue={position.productMatch?.entry?.unitWeightGrams}
                      onConfirm={(entry) => onConfirmProductMapping(invoice.id, position.id, entry)}
                    />
                  )}
                </td>
                <td>{position.calculatedWeightKgRounded != null ? formatGermanNumber(position.calculatedWeightKgRounded, 2) : '—'}</td>
                <td>
                  <FormattedNumberInput
                    value={position.amountEur}
                    decimals={2}
                    className="number-input"
                    onCommit={(v) => onEditPosition(invoice.id, position.id, { amountEur: v }, 'amountEur')}
                  />
                </td>
                <td>
                  {position.isMtzSurcharge ? (
                    <span className="hint">
                      Materialteuerungszuschlag – der vorangehenden Artikelposition zugerechnet.
                    </span>
                  ) : position.isTransportCost ? (
                    '—'
                  ) : (
                    <StatusBadge status={position.status} />
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
                  {position.isManualEntry && (
                    <button type="button" onClick={() => onRemovePosition(invoice.id, position.id)}>
                      Position entfernen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="step-actions">
        <button type="button" onClick={() => onAddPosition(invoice.id)}>
          Position hinzufügen
        </button>
      </div>
          </>
        )}
      </section>
    </div>
  )
}

/**
 * Zeigt an, woher die Gewichtszuordnung stammt (Produktbeschreibung, manuelle
 * Korrektur oder kein Treffer). Ein Treffer im Artikel-Gewichtsmapping selbst
 * wird hier NICHT mehr als Text ausgewiesen – das ist an der Artikelnummer
 * und dem eingetragenen Einzelgewicht bereits erkennbar. Die Eingabe des
 * Gewichts erfolgt direkt in der Spalte „Einzelgewicht (g)“ (siehe
 * `ManualWeightEntry`).
 */
function ProductMappingCell({ position }: { position: InvoicePosition }) {
  if (position.isCreditOrDiscountOrNegative) return null
  if (position.isTransportCost) return null
  if (position.isMtzSurcharge) return <span className="hint">Materialteuerungszuschlag – keine Warenposition</span>
  if (position.productMatch?.entry) return null

  return <span className="hint hint--error">Kein Treffer – Gewicht bitte eintragen</span>
}

/**
 * Formatiert-editierbares Zahlenfeld (deutsches Format "#.###" bzw.
 * "#.###,##"): Solange das Feld fokussiert ist, wird der roh eingegebene
 * Text angezeigt (kein Cursor-Sprung); beim Verlassen des Felds wird der
 * aktuelle Wert neu formatiert dargestellt. Jede Änderung wird sofort über
 * `onCommit` gemeldet.
 */
function FormattedNumberInput({
  value,
  decimals,
  className,
  onCommit,
}: {
  value: number | undefined
  decimals: number
  className?: string
  onCommit: (value: number | undefined) => void
}) {
  const [editingText, setEditingText] = useState<string | null>(null)
  const displayValue = editingText != null ? editingText : value != null ? formatGermanNumber(value, decimals) : ''

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={displayValue}
      onFocus={() => setEditingText(value != null ? String(value).replace('.', ',') : '')}
      onChange={(e) => {
        setEditingText(e.target.value)
        const parsed = e.target.value.trim() === '' ? null : parseGermanNumber(e.target.value)
        onCommit(parsed == null ? undefined : parsed)
      }}
      onBlur={() => setEditingText(null)}
    />
  )
}

/**
 * Zeigt das Einzelgewicht (g) direkt editierbar an – vorbelegt mit dem
 * automatisch ermittelten Wert, falls vorhanden, kaufmännisch auf vier
 * Nachkommastellen gerundet dargestellt (der intern für die Berechnung
 * verwendete Wert selbst wird NICHT gerundet – wichtig für Eingangsrechnungen,
 * deren Einzelgewichte beliebig viele Nachkommastellen haben dürfen). So kann
 * ein veraltetes oder falsches Gewicht jederzeit korrigiert werden, ohne erst
 * einen Aufklapp-Schritt zu öffnen. Da eine Bestätigung mit Artikelnummer
 * direkt in die hinterlegte Gewichtsliste übernommen wird, fragt "Übernehmen"
 * das vorher ausdrücklich per Pop-up nach.
 */
function ManualWeightEntry({
  position,
  onConfirm,
  initialValue,
}: {
  position: InvoicePosition
  onConfirm: (entry: ProductWeightEntry) => void
  initialValue?: number
}) {
  const [editingText, setEditingText] = useState<string | null>(null)
  const displayValue =
    editingText != null ? editingText : initialValue != null ? formatGermanNumber(initialValue, 4) : ''
  const parsed = editingText != null ? parseGermanNumber(editingText) : (initialValue ?? null)
  const isValid = parsed != null && parsed > 0
  const changed = isValid && parsed !== initialValue

  function confirm() {
    if (!changed || parsed == null) return
    const articleNumber = position.articleNumberRaw?.trim()
    if (articleNumber) {
      const proceed = window.confirm(
        `Achtung! Die gewählte Änderung wird für den Artikel ${articleNumber} in der Gewichtsliste aktualisiert. Möchten Sie fortfahren?`,
      )
      if (!proceed) return
    }
    onConfirm({
      name: articleNumber || position.productNameRaw.trim() || 'Manuell erfasstes Gewicht',
      unitWeightGrams: parsed,
      zusatz: 'manuell erfasst',
    })
    setEditingText(null)
  }

  return (
    <div className="manual-weight-entry__form">
      <input
        type="text"
        inputMode="decimal"
        className="number-input"
        placeholder="g je Stück"
        value={displayValue}
        onFocus={() => setEditingText(initialValue != null ? String(initialValue).replace('.', ',') : '')}
        onChange={(e) => setEditingText(e.target.value)}
        onBlur={() => setEditingText(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirm()
        }}
      />
      <button type="button" disabled={!changed} onMouseDown={(e) => e.preventDefault()} onClick={confirm}>
        übernehmen
      </button>
    </div>
  )
}
