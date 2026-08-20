import type { AiDiscrepancy, AiInvoiceFields, Invoice } from '../types'
import { normalizeForMatch } from './productMatcher'

/**
 * Vergleicht die regelbasiert erkannten Werte mit der KI-Zweitmeinung und
 * liefert die Abweichungen.
 *
 * Grundsatz: Die regelbasierte Erkennung bleibt maßgeblich. Die KI-Antwort
 * wird niemals automatisch übernommen – jede Abweichung muss in der
 * Prüfansicht entschieden werden (eigener Wert behalten oder KI-Wert
 * übernehmen).
 */

function normalizeText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ')
}

function formatValue(value: unknown): string {
  if (value == null || value === '') return '(leer)'
  return String(value)
}

/** Zahlenvergleich mit Toleranz gegen Rundungs-/Formatierungsunterschiede. */
function numbersDiffer(own: number | undefined, ai: number | null | undefined, tolerance = 0.005): boolean {
  if (own == null || ai == null) return false
  return Math.abs(own - ai) > tolerance
}

let counter = 0
function discrepancy(
  field: string,
  label: string,
  ownValue: unknown,
  aiValue: unknown,
): AiDiscrepancy {
  counter += 1
  return {
    id: `ai-${counter}`,
    field,
    label,
    ownValue: formatValue(ownValue),
    aiValue: formatValue(aiValue),
    resolved: false,
  }
}

export function compareWithAi(invoice: Invoice, ai: AiInvoiceFields): AiDiscrepancy[] {
  const result: AiDiscrepancy[] = []

  /* ------------------------------------------------------------ Kopf-Felder */

  if (ai.invoiceNumber && normalizeText(ai.invoiceNumber) !== normalizeText(invoice.invoiceNumber)) {
    result.push(discrepancy('invoiceNumber', 'Rechnungsnummer', invoice.invoiceNumber, ai.invoiceNumber))
  }

  if (ai.invoiceDate && normalizeText(ai.invoiceDate) !== normalizeText(invoice.invoiceDateRaw)) {
    result.push(discrepancy('invoiceDateRaw', 'Rechnungsdatum', invoice.invoiceDateRaw, ai.invoiceDate))
  }

  if (ai.vatId) {
    const aiVat = ai.vatId.replace(/\s+/g, '').toUpperCase()
    if (aiVat !== (invoice.vatId ?? '').toUpperCase()) {
      result.push(discrepancy('vatId', 'USt-IdNr.', invoice.vatId, aiVat))
    }
  }

  if (ai.destinationCountryCode) {
    const aiCode = ai.destinationCountryCode.trim().toUpperCase()
    if (aiCode !== (invoice.destinationCountry?.code ?? '')) {
      result.push(
        discrepancy('destinationCountry', 'Bestimmungsland', invoice.destinationCountry?.code, aiCode),
      )
    }
  }

  if (numbersDiffer(invoice.netWeightTotal, ai.netWeightTotalKg, 0.01)) {
    result.push(
      discrepancy('netWeightTotal', 'Netto-Gesamtgewicht (kg)', invoice.netWeightTotal, ai.netWeightTotalKg),
    )
  }

  if (numbersDiffer(invoice.freightCost, ai.freightCostEur, 0.01)) {
    result.push(discrepancy('freightCost', 'Frachtkosten (EUR)', invoice.freightCost, ai.freightCostEur))
  }

  /* -------------------------------------------------------------- Positionen */

  const aiPositions = ai.positions ?? []

  if (aiPositions.length !== invoice.positions.length) {
    result.push(
      discrepancy(
        'positionCount',
        'Anzahl Rechnungspositionen',
        invoice.positions.length,
        aiPositions.length,
      ),
    )
  }

  for (const position of invoice.positions) {
    // Zuordnung bevorzugt über die Positionsnummer, sonst über die Reihenfolge.
    const aiPosition =
      aiPositions.find(
        (p) => p.positionNumber != null && normalizeText(p.positionNumber) === normalizeText(position.positionNumber),
      ) ?? aiPositions[position.lineNo - 1]

    if (!aiPosition) continue

    const prefix = `Position ${position.positionNumber ?? position.lineNo}`
    const fieldPrefix = `position:${position.id}`

    if (aiPosition.customsCode) {
      const aiCode = aiPosition.customsCode.replace(/\D/g, '')
      if (aiCode && aiCode !== (position.customsCode ?? '')) {
        result.push(
          discrepancy(`${fieldPrefix}:customsCode`, `${prefix}: Warennummer`, position.customsCode, aiCode),
        )
      }
    }

    if (numbersDiffer(position.quantity, aiPosition.quantity)) {
      result.push(
        discrepancy(`${fieldPrefix}:quantity`, `${prefix}: Menge`, position.quantity, aiPosition.quantity),
      )
    }

    if (numbersDiffer(position.amountEur, aiPosition.amountEur, 0.01)) {
      result.push(
        discrepancy(
          `${fieldPrefix}:amountEur`,
          `${prefix}: Positionsbetrag (EUR)`,
          position.amountEur,
          aiPosition.amountEur,
        ),
      )
    }

    // Produktbezeichnungen werden nur gemeldet, wenn sie sich inhaltlich
    // unterscheiden – reine Schreibweisen-Unterschiede sind unerheblich.
    if (
      aiPosition.productDescription &&
      normalizeForMatch(aiPosition.productDescription) !== normalizeForMatch(position.productNameRaw)
    ) {
      result.push(
        discrepancy(
          `${fieldPrefix}:productNameRaw`,
          `${prefix}: Produktbezeichnung`,
          position.productNameRaw,
          aiPosition.productDescription,
        ),
      )
    }

    // Gewicht aus der Produktbeschreibung (Flaschenartikel)
    const ownDescriptionWeight =
      position.productMatch?.matchType === 'beschreibung'
        ? position.productMatch.entry?.unitWeightGrams
        : undefined
    if (aiPosition.weightPerPieceGrams != null && numbersDiffer(ownDescriptionWeight, aiPosition.weightPerPieceGrams, 0.01)) {
      result.push(
        discrepancy(
          `${fieldPrefix}:descriptionWeight`,
          `${prefix}: Gewicht aus der Produktbeschreibung (g)`,
          ownDescriptionWeight,
          aiPosition.weightPerPieceGrams,
        ),
      )
    }

    if (
      aiPosition.isCreditOrDiscount === true &&
      !position.isCreditOrDiscountOrNegative &&
      !position.negativeDecisionMade
    ) {
      result.push(
        discrepancy(
          `${fieldPrefix}:credit`,
          `${prefix}: mögliche Gutschrift/Rabatt`,
          'als normale Position erkannt',
          'Gutschrift/Storno/Rabatt',
        ),
      )
    }
  }

  return result
}

/** Felder, bei denen die KI selbst Unsicherheit gemeldet hat. */
export function aiUncertaintyNotes(ai: AiInvoiceFields): string[] {
  return (ai.uncertainFields ?? []).filter((f) => typeof f === 'string' && f.trim().length > 0)
}
