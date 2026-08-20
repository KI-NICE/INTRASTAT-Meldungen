import type { AiDiscrepancy, Invoice, InvoicePosition } from '../types'
import { deriveReferencePeriod } from './invoiceParser'

/**
 * Übernimmt einen von der KI gelesenen Wert in die Rechnungsdaten – nur auf
 * ausdrückliche Entscheidung in der Prüfansicht, nie automatisch.
 *
 * Jede Übernahme wird als manuelle Korrektur protokolliert, damit
 * nachvollziehbar bleibt, welcher Wert ursprünglich erkannt wurde.
 */

const POSITION_FIELD = /^position:(.+):([a-zA-Z]+)$/

/** Felder, deren KI-Wert direkt übernommen werden kann. */
export function canApplyAiValue(field: string): boolean {
  if (['invoiceNumber', 'invoiceDateRaw', 'vatId', 'destinationCountry', 'netWeightTotal', 'freightCost'].includes(field)) {
    return true
  }
  const match = field.match(POSITION_FIELD)
  if (!match) return false
  return ['customsCode', 'quantity', 'amountEur', 'productNameRaw', 'credit'].includes(match[2])
}

function parseNumber(value: string): number | undefined {
  if (!value || value === '(leer)') return undefined
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseText(value: string): string | undefined {
  return !value || value === '(leer)' ? undefined : value
}

export function applyAiValue(invoice: Invoice, discrepancy: AiDiscrepancy): Invoice {
  const note = {
    field: `KI-Übernahme: ${discrepancy.label}`,
    originalValue: discrepancy.ownValue,
    newValue: discrepancy.aiValue,
    timestamp: 0,
  }

  const positionMatch = discrepancy.field.match(POSITION_FIELD)

  if (positionMatch) {
    const [, positionId, key] = positionMatch
    const positions: InvoicePosition[] = invoice.positions.map((position) => {
      if (position.id !== positionId) return position
      const next: InvoicePosition = { ...position, manualCorrections: [...position.manualCorrections, note] }

      switch (key) {
        case 'customsCode': {
          const code = (parseText(discrepancy.aiValue) ?? '').replace(/\D/g, '')
          next.customsCode = code
          next.isSpecialUnit = code === '39233010'
          break
        }
        case 'quantity':
          next.quantity = parseNumber(discrepancy.aiValue)
          break
        case 'amountEur':
          next.amountEur = parseNumber(discrepancy.aiValue)
          break
        case 'productNameRaw':
          next.productNameRaw = parseText(discrepancy.aiValue) ?? position.productNameRaw
          // Zuordnung muss neu ermittelt werden.
          next.productMatch = undefined
          break
        case 'credit':
          next.isCreditOrDiscountOrNegative = true
          next.negativeDecisionMade = false
          break
        default:
          break
      }
      return next
    })
    return { ...invoice, positions }
  }

  const updated: Invoice = { ...invoice, manualCorrections: [...invoice.manualCorrections, note] }

  switch (discrepancy.field) {
    case 'invoiceNumber':
      updated.invoiceNumber = parseText(discrepancy.aiValue)
      break
    case 'invoiceDateRaw': {
      updated.invoiceDateRaw = parseText(discrepancy.aiValue)
      const period = deriveReferencePeriod(updated.invoiceDateRaw)
      updated.referenceMonth = period?.month
      updated.referenceYear = period?.year
      break
    }
    case 'vatId':
      updated.vatId = parseText(discrepancy.aiValue)?.replace(/\s+/g, '')
      break
    case 'destinationCountry':
      updated.destinationCountry = {
        code: parseText(discrepancy.aiValue) ?? null,
        source: 'manual',
        isManual: true,
        token: invoice.destinationCountry?.token ?? null,
        needsConfirmation: false,
      }
      break
    case 'netWeightTotal':
      updated.netWeightTotal = parseNumber(discrepancy.aiValue)
      break
    case 'freightCost':
      updated.freightCost = parseNumber(discrepancy.aiValue)
      break
    default:
      // Nicht übernehmbare Abweichung (z. B. Anzahl Positionen) – es bleibt
      // beim eigenen Wert, die Abweichung ist lediglich bestätigt.
      break
  }

  return updated
}
