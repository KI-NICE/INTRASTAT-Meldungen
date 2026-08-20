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

  if (invoice.extractionFailed) {
    issues.push(
      makeIssue(
        'extraction',
        'error',
        `„${invoice.fileName}“ konnte nicht ausreichend gelesen werden (auch nicht per OCR) – manuelle Prüfung erforderlich.`,
      ),
    )
  }

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

  if (!invoice.hasFontInfo && !invoice.extractionFailed) {
    issues.push(
      makeIssue(
        'fontInfo',
        'error',
        'In dieser PDF ist kein Fettdruck erkennbar (z. B. nach Texterkennung). Positionsnummern, Mengen und die Rechnungsnummer können deshalb nicht sicher gelesen werden – bitte alle Positionen prüfen und bestätigen.',
      ),
    )
  }

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
  }

  if (!invoice.vatId) {
    issues.push(makeIssue('vatId', 'error', 'Die USt-IdNr. des Warenempfängers wurde nicht erkannt.'))
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

  if (invoice.ai?.status === 'fehler') {
    issues.push(
      makeIssue(
        'ai',
        'warning',
        `Die KI-Zweitmeinung ist fehlgeschlagen: ${invoice.ai.error ?? 'unbekannter Fehler'}. Die regelbasierte Erkennung gilt unverändert.`,
      ),
    )
  }

  for (const discrepancy of invoice.ai?.discrepancies ?? []) {
    if (discrepancy.resolved) continue
    issues.push(
      makeIssue(
        `ai:${discrepancy.id}`,
        'error',
        `Abweichung zur KI-Zweitmeinung bei „${discrepancy.label}“: erkannt „${discrepancy.ownValue}“, KI liest „${discrepancy.aiValue}“. Bitte entscheiden.`,
      ),
    )
  }

  for (const field of invoice.ai?.uncertainFields ?? []) {
    issues.push(
      makeIssue(
        `ai-uncertain:${field}`,
        'warning',
        `Die KI hat das Feld „${field}“ als unsicher gemeldet – bitte besonders prüfen.`,
      ),
    )
  }

  const updatedPositions = invoice.positions.map((position) => validatePosition(position))

  const relevantPositions = updatedPositions.filter((p) => !p.isCreditOrDiscountOrNegative)
  if (invoice.netWeightTotal != null && relevantPositions.length > 0) {
    const calculatedSum = relevantPositions.reduce((sum, p) => sum + (p.calculatedWeightKgRounded ?? 0), 0)
    const difference = calculatedSum - invoice.netWeightTotal
    if (Math.abs(difference) > 0) {
      issues.push(
        makeIssue(
          'weightSum',
          'error',
          `Die berechnete Eigenmasse beträgt ${calculatedSum} kg, auf der Rechnung stehen ${invoice.netWeightTotal} kg (Differenz ${difference} kg). Bitte Zuordnung/Werte prüfen.`,
        ),
      )
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
          `Für Produkt „${position.productNameRaw}“ wurde keine sichere Zuordnung in der Gewichtsliste gefunden. Bitte manuell zuordnen.`,
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
