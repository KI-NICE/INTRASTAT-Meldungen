import type { Invoice, InvoicePosition, ProductWeightEntry } from '../types'
import { extractPdfText } from './pdfExtract'
import { parseInvoiceText, determineDestinationCountry } from './invoiceParser'
import { matchProduct } from './productMatcher'
import { calculateAmountWithFreight, calculatePositionWeight, calculateStatisticalValues } from './calculations'
import { validateInvoice } from './validation'

let invoiceCounter = 0

/**
 * Berechnet Produktzuordnung, Gewichte, Beträge und den statistischen Wert
 * für alle Positionen einer Rechnung neu und führt anschließend die
 * Validierung (Anforderung Abschnitt 8) aus. Wird sowohl bei der initialen
 * PDF-Verarbeitung als auch nach jeder manuellen Korrektur in der Prüfansicht
 * aufgerufen, damit der Zustand stets konsistent ist.
 */
export function recalculateInvoice(
  invoice: Invoice,
  weightList: ProductWeightEntry[],
  selectedMonth: string,
  selectedYear: string,
  sessionMappings: Record<string, ProductWeightEntry>,
): Invoice {
  const positions: InvoicePosition[] = invoice.positions.map((position) => {
    if (position.isCreditOrDiscountOrNegative) {
      return { ...position, productMatch: undefined, calculatedWeightKgRaw: undefined, calculatedWeightKgRounded: undefined }
    }

    // Eine bereits manuell bestätigte Zuordnung (matchType 'manual') bleibt
    // erhalten, statt erneut automatisch ermittelt zu werden.
    const productMatch =
      position.productMatch?.matchType === 'manual'
        ? position.productMatch
        : matchProduct(position.productNameRaw, weightList, sessionMappings)

    let calculatedWeightKgRaw: number | undefined
    let calculatedWeightKgRounded: number | undefined
    if (productMatch.entry && position.quantity != null) {
      const weight = calculatePositionWeight(productMatch.entry.unitWeightGrams, position.quantity)
      calculatedWeightKgRaw = weight.rawKg
      calculatedWeightKgRounded = weight.roundedKg
    }

    return { ...position, productMatch, calculatedWeightKgRaw, calculatedWeightKgRounded }
  })

  const relevantPositions = positions.filter((p) => !p.isCreditOrDiscountOrNegative)
  const { roundedAmounts, rawAmounts } = calculateAmountWithFreight(relevantPositions, invoice.freightCost)
  const { rawValues, roundedValues } = calculateStatisticalValues(rawAmounts)

  let idx = 0
  const positionsWithAmounts = positions.map((position) => {
    if (position.isCreditOrDiscountOrNegative) return position
    const amountWithFreightEurRaw = rawAmounts[idx]
    const amountEurRounded = roundedAmounts[idx]
    const statisticalSurchargeEurRaw = rawValues[idx] - (position.amountEur ?? 0)
    const statisticalValueEurRounded = roundedValues[idx]
    idx += 1
    return {
      ...position,
      amountWithFreightEurRaw,
      amountEurRounded,
      statisticalSurchargeEurRaw,
      statisticalValueEurRounded,
    }
  })

  const updatedInvoice: Invoice = { ...invoice, positions: positionsWithAmounts }

  const { issues, positions: validatedPositions } = validateInvoice(updatedInvoice, selectedMonth, selectedYear)
  updatedInvoice.issues = issues
  updatedInvoice.positions = validatedPositions
  updatedInvoice.status = issues.some((i) => i.severity === 'error' && !i.resolved)
    ? 'error'
    : issues.some((i) => i.severity === 'warning' && !i.resolved)
      ? 'warning'
      : 'ok'

  return updatedInvoice
}

/**
 * Verarbeitet eine hochgeladene PDF-Datei vollständig: Text-/OCR-Extraktion,
 * Feld- und Positionserkennung, Produktzuordnung, Berechnungen und
 * Validierung. Liefert ein vollständiges Invoice-Objekt für die Prüfansicht.
 */
export async function processInvoiceFile(
  file: File,
  weightList: ProductWeightEntry[],
  selectedMonth: string,
  selectedYear: string,
  sessionMappings: Record<string, ProductWeightEntry>,
): Promise<Invoice> {
  invoiceCounter += 1
  const id = `invoice-${invoiceCounter}-${file.name}`

  const { text, ocrUsed, extractionFailed } = await extractPdfText(file)
  const fields = parseInvoiceText(text)
  const destination = determineDestinationCountry(fields.deliveryAddress, fields.recipient)

  const baseInvoice: Invoice = {
    id,
    fileName: file.name,
    rawText: text,
    ocrUsed,
    extractionFailed,
    invoiceNumber: fields.invoiceNumber,
    invoiceDateRaw: fields.invoiceDateRaw,
    referenceMonth: fields.referenceMonth,
    referenceYear: fields.referenceYear,
    recipient: fields.recipient,
    deliveryAddress: fields.deliveryAddress,
    destinationCountry: {
      code: destination.code,
      source: destination.source,
      isManual: false,
    },
    vatIdRaw: fields.vatIdRaw,
    vatId: fields.vatId,
    netWeightTotalRaw: fields.netWeightTotalRaw,
    netWeightTotal: fields.netWeightTotal,
    goodsValueTotalRaw: fields.goodsValueTotalRaw,
    goodsValueTotal: fields.goodsValueTotal,
    freightCostRaw: fields.freightCostRaw,
    freightCost: fields.freightCost,
    positions: fields.positions,
    manualCorrections: [],
    issues: [],
    status: 'pending',
  }

  return recalculateInvoice(baseInvoice, weightList, selectedMonth, selectedYear, sessionMappings)
}
