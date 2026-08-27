import type { Invoice, InvoicePosition, ValidationIssue } from '../types'
import { isValidCustomsCode, referenceMonthMatches } from './calculations'

let issueCounter = 0
function makeIssue(field: string, severity: ValidationIssue['severity'], message: string): ValidationIssue {
  issueCounter += 1
  return { id: `issue-${issueCounter}`, field, severity, message, resolved: false }
}

/**
 * Führt die in Anforderung Abschnitt 8 geforderten Prüfungen für eine
 * einzelne Rechnung und ihre Positionen aus. Gibt die aktualisierten
 * Positionen sowie rechnungsweite Issues zurück.
 */
export function validateInvoice(
  invoice: Invoice,
  selectedMonth: string,
  selectedYear: string,
): { issues: ValidationIssue[]; positions: InvoicePosition[] } {
  const issues: ValidationIssue[] = []

  if (!invoice.invoiceDateRaw) {
    issues.push(
      makeIssue(
        'invoiceDate',
        'error',
        'Das Rechnungsdatum (Feld „vom:“ unter der Rechnungsnummer) wurde nicht erkannt.',
      ),
    )
  }

  if (!invoice.referenceMonth || !invoice.referenceYear) {
    issues.push(
      makeIssue('referenceMonth', 'error', 'Der Bezugsmonat konnte nicht aus dem Rechnungsdatum abgeleitet werden.'),
    )
  } else if (!referenceMonthMatches(invoice.referenceMonth, invoice.referenceYear, selectedMonth, selectedYear)) {
    issues.push(
      makeIssue(
        'referenceMonth',
        'error',
        `Die Rechnung gehört laut Rechnungsdatum (${invoice.invoiceDateRaw}) zum Monat ${invoice.referenceMonth}-${invoice.referenceYear}, ausgewählt wurde aber ${selectedMonth}-${selectedYear}.`,
      ),
    )
  }

  // Das Bestimmungsland (Spalte F) gilt nur für Ausgangsrechnungen – bei
  // Eingangsrechnungen entfällt Spalte F vollständig (siehe excelTemplate.ts).
  if (invoice.richtung === 'V') {
    if (!invoice.destinationCountry?.code) {
      issues.push(
        makeIssue(
          'destinationCountry',
          'error',
          'Das Bestimmungsland wurde nicht eindeutig bestimmt. Bitte manuell auswählen – die Auswahl wird für diese Adresse gespeichert.',
        ),
      )
    } else if (invoice.destinationCountry.needsConfirmation && !invoice.destinationCountry.isManual) {
      issues.push(
        makeIssue(
          'destinationCountry',
          'error',
          `Vorschlag für das Bestimmungsland: „${invoice.destinationCountry.code}“ (nicht aus der Lieferadresse ableitbar). Bitte bestätigen oder korrigieren – die Entscheidung wird für diese Adresse gespeichert.`,
        ),
      )
    } else if (invoice.destinationCountry.source === 'vat-id-override') {
      issues.push(
        makeIssue(
          'destinationCountry',
          'warning',
          `Das Bestimmungsland wurde anhand der USt-IdNr. auf „${invoice.destinationCountry.code}“ korrigiert (Lieferadresse deutete auf „${invoice.destinationCountry.overriddenAddressCode ?? '—'}“ hin).`,
        ),
      )
    }
  }

  // Spalte P (USt-IdNr.) entfällt bei Eingangsrechnungen vollständig (siehe
  // excelTemplate.ts) und wird deshalb auch nur für Ausgangsrechnungen geprüft.
  if (invoice.richtung === 'V' && !invoice.vatId) {
    issues.push(makeIssue('vatId', 'error', 'Die USt-IdNr. des Warenempfängers wurde nicht erkannt.'))
  }

  if (invoice.richtung === 'E') {
    // G (fest "09") und H (entfällt) sind bei Eingangsrechnungen fest
    // vorbelegt bzw. nicht mehr relevant und werden daher nicht mehr geprüft.
    const columnChecks: Array<{ field: keyof Invoice; label: string; column: string }> = [
      { field: 'versendungsMitgliedstaat', label: 'Versendungsmitgliedstaat', column: 'E' },
      { field: 'ursprungsland', label: 'Ursprungsland', column: 'I' },
    ]
    for (const check of columnChecks) {
      const value = invoice[check.field]
      if (!value || (typeof value === 'string' && value.trim().length === 0)) {
        issues.push(
          makeIssue(
            check.field as string,
            'error',
            `${check.label} (Spalte ${check.column}) konnte nicht aus der Rechnung gelesen werden. Bitte manuell eintragen.`,
          ),
        )
      }
    }
  }

  if (invoice.netWeightTotal == null) {
    issues.push(
      makeIssue(
        'netWeightTotal',
        'error',
        'Das Netto-Gesamtgewicht („Net weight:“ bzw. „Netto:“ in der Fußzeile) wurde nicht erkannt.',
      ),
    )
  }

  if (invoice.positions.length === 0) {
    issues.push(makeIssue('positions', 'error', 'Es wurden keine Rechnungspositionen erkannt.'))
  }

  const updatedPositions = invoice.positions.map((position) => validatePosition(position))

  const relevantPositions = updatedPositions.filter(
    (p) => !p.isCreditOrDiscountOrNegative && !p.isTransportCost && !p.isMtzSurcharge,
  )
  if (invoice.netWeightTotal != null && relevantPositions.length > 0) {
    const calculatedSum = relevantPositions.reduce((sum, p) => sum + (p.calculatedWeightKgRounded ?? 0), 0)
    const difference = calculatedSum - invoice.netWeightTotal
    // Abweichungen von 1-2 kg gelten als unkritisch und sperren den Export
    // nicht – es wird bewusst KEINE Meldung erzeugt, stattdessen zeigt die
    // Prüfansicht direkt am Dokumentnamen das Badge "Toleranz < 2 kg" (siehe
    // ReviewTable.tsx). Erst darüber wird eine Bestätigung verlangt.
    const withinAutoTolerance = Math.abs(difference) > 0 && Math.abs(difference) <= 2
    if (Math.abs(difference) > 0 && !withinAutoTolerance) {
      if (invoice.weightToleranceAccepted) {
        issues.push(
          makeIssue(
            'weightSum',
            'warning',
            `Differenz zwischen berechneter Eigenmasse (${calculatedSum} kg) und Rechnung (${invoice.netWeightTotal} kg) von ${difference} kg – Toleranz manuell bestätigt.`,
          ),
        )
      } else {
        issues.push(
          makeIssue(
            'weightSum',
            'error',
            `Die berechnete Eigenmasse beträgt ${calculatedSum} kg, auf der Rechnung stehen ${invoice.netWeightTotal} kg (Differenz ${difference} kg). Bitte Zuordnung/Werte prüfen oder Toleranz bestätigen.`,
          ),
        )
      }
    }
  }

  for (const position of updatedPositions) {
    if (position.isCreditOrDiscountOrNegative && !position.negativeDecisionMade) {
      issues.push(
        makeIssue(
          `position-${position.id}`,
          'error',
          `Position ${position.lineNo} („${position.productNameRaw}“) sieht nach Gutschrift/Storno/Rabatt oder negativem Betrag aus und erfordert eine manuelle Entscheidung.`,
        ),
      )
    }
  }

  return { issues, positions: updatedPositions }
}

function validatePosition(position: InvoicePosition): InvoicePosition {
  // "09"-Positionen (Frachtkosten, sonstige Zuschläge, zugerechnete
  // Materialteuerungszuschläge) werden nicht als eigene Intrastat-Zeile
  // gemeldet und deshalb auch nicht wie normale Warenpositionen validiert.
  if (position.isTransportCost || position.isMtzSurcharge) {
    return { ...position, issues: [], status: 'ok' }
  }

  const issues: ValidationIssue[] = []

  if (!position.customsCode) {
    issues.push(
      makeIssue(
        `position-${position.id}-customsCode`,
        'error',
        `Position ${position.lineNo}: Die Warennummer wurde nicht erkannt.`,
      ),
    )
  } else if (!isValidCustomsCode(position.customsCode)) {
    issues.push(
      makeIssue(
        `position-${position.id}-customsCode`,
        'error',
        `Die Warennummer der Position ${position.lineNo} enthält ${position.customsCode.length} Ziffern statt acht. Bitte korrigieren Sie den Wert.`,
      ),
    )
  }

  if (position.quantity == null) {
    issues.push(
      makeIssue(
        `position-${position.id}-quantity`,
        'error',
        `Position ${position.lineNo}: Die Menge konnte nicht aus dem Zahlenformat gelesen werden.`,
      ),
    )
  }

  if (position.amountEur == null) {
    issues.push(
      makeIssue(
        `position-${position.id}-amount`,
        'error',
        `Position ${position.lineNo}: Der Betrag konnte nicht aus dem Zahlenformat gelesen werden.`,
      ),
    )
  }

  if (!position.isCreditOrDiscountOrNegative) {
    if (!position.productMatch || position.productMatch.matchType === 'none') {
      issues.push(
        makeIssue(
          `position-${position.id}-product`,
          'error',
          `Für Artikel „${position.articleNumberRaw ?? position.productNameRaw}“ wurde kein Gewicht gefunden. Bitte manuell eintragen.`,
        ),
      )
    }
  }

  if (position.isSpecialUnit && position.quantity == null) {
    issues.push(
      makeIssue(
        `position-${position.id}-specialUnit`,
        'error',
        `Position ${position.lineNo}: Für Spalte M (Warennummer 39233010) fehlt die Menge.`,
      ),
    )
  }

  const status: InvoicePosition['status'] = issues.some((i) => i.severity === 'error')
    ? 'error'
    : issues.length > 0
      ? 'warning'
      : 'ok'

  return { ...position, issues, status }
}

export function invoiceHasUnresolvedIssues(invoice: Invoice): boolean {
  return invoice.issues.some((i) => !i.resolved) || invoice.positions.some((p) => p.issues.some((i) => !i.resolved))
}

export function computeInvoiceStatus(issues: ValidationIssue[]): Invoice['status'] {
  if (issues.some((i) => i.severity === 'error' && !i.resolved)) return 'error'
  if (issues.some((i) => i.severity === 'warning' && !i.resolved)) return 'warning'
  return 'ok'
}
