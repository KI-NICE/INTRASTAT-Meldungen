import type { Invoice, InvoicePosition } from '../types'
import { roundUp } from './germanNumber'

const STATISTICAL_SURCHARGE_RATE = 0.04
const WEIGHT_TOLERANCE_KG = 0 // Konzept Abschnitt 1, Frage 4: 0 kg = exakt

/**
 * Berechnet das Positionsgewicht (Einzelgewicht [g] × Menge), roh in kg
 * sowie nach Rundungsregel (immer aufrunden auf volle kg).
 */
export function calculatePositionWeight(unitWeightGrams: number, quantity: number): {
  rawKg: number
  roundedKg: number
} {
  const rawKg = (unitWeightGrams * quantity) / 1000
  return { rawKg, roundedKg: roundUp(rawKg) }
}

/**
 * Verteilt Frachtkosten anteilig nach Wertanteil der Position auf den
 * Rechnungsbetrag (Konzept Abschnitt 1, Regel 8) und rundet danach je
 * Position auf volle EUR auf (Spalte N).
 */
export function calculateAmountWithFreight(
  positions: Pick<InvoicePosition, 'amountEur'>[],
  freightCost: number | undefined,
): { rawAmounts: number[]; roundedAmounts: number[] } {
  const values = positions.map((p) => p.amountEur ?? 0)
  const totalValue = values.reduce((sum, v) => sum + v, 0)

  if (!freightCost || totalValue === 0) {
    return { rawAmounts: values, roundedAmounts: values.map((v) => roundUp(v)) }
  }

  const rawAmounts = values.map((v) => v + (v / totalValue) * freightCost)
  return { rawAmounts, roundedAmounts: rawAmounts.map((v) => roundUp(v)) }
}

/**
 * Berechnet den statistischen Wert je Position: Positionswert + anteiliger
 * 4-%-Zuschlag auf den gesamten Warenwert, verteilt nach Wertanteil (Konzept
 * Abschnitt 1, Regel 5), danach je Position auf volle EUR aufgerundet.
 */
export function calculateStatisticalValues(
  positionValues: number[],
): { rawValues: number[]; roundedValues: number[]; totalSurcharge: number } {
  const totalValue = positionValues.reduce((sum, v) => sum + v, 0)
  const totalSurcharge = totalValue * STATISTICAL_SURCHARGE_RATE

  const rawValues = positionValues.map((v) => {
    const share = totalValue === 0 ? 0 : v / totalValue
    return v + share * totalSurcharge
  })

  return {
    rawValues,
    roundedValues: rawValues.map((v) => roundUp(v)),
    totalSurcharge,
  }
}

export type WeightCheckResult = {
  calculatedSumRaw: number
  calculatedSumRounded: number
  netWeightTotal: number
  differenceKg: number
  withinTolerance: boolean
}

/**
 * Vergleicht die Summe der (bereits gerundeten) Positionsgewichte mit dem
 * Netto-Gesamtgewicht laut Rechnung. Siehe Konzept Abschnitt 1 für die
 * Begründung, warum die gerundete Summe (und nicht die rohe Summe) für die
 * Toleranzprüfung herangezogen wird.
 */
export function checkWeightSum(
  positions: { calculatedWeightKgRaw?: number; calculatedWeightKgRounded?: number }[],
  netWeightTotal: number,
): WeightCheckResult {
  const calculatedSumRaw = positions.reduce((sum, p) => sum + (p.calculatedWeightKgRaw ?? 0), 0)
  const calculatedSumRounded = positions.reduce((sum, p) => sum + (p.calculatedWeightKgRounded ?? 0), 0)
  const differenceKg = calculatedSumRounded - netWeightTotal
  return {
    calculatedSumRaw,
    calculatedSumRounded,
    netWeightTotal,
    differenceKg,
    withinTolerance: Math.abs(differenceKg) <= WEIGHT_TOLERANCE_KG,
  }
}

export function isValidCustomsCode(code: string | undefined): boolean {
  return !!code && /^[0-9]{8}$/.test(code)
}

/** Prüft, ob der Bezugsmonat der Rechnung (aus "Vom:") zum gewählten Bezugsmonat passt. */
export function referenceMonthMatches(
  invoiceMonth: string | undefined,
  invoiceYear: string | undefined,
  selectedMonth: string,
  selectedYear: string,
): boolean {
  if (!invoiceMonth || !invoiceYear) return false
  return invoiceMonth === selectedMonth && invoiceYear === selectedYear
}

export function summarizeInvoices(invoices: Invoice[]) {
  const processedInvoices = invoices.length
  const rows = invoices.flatMap((inv) =>
    inv.positions.filter((p) => !p.isCreditOrDiscountOrNegative && !p.isTransportCost && !p.isMtzSurcharge),
  )
  const generatedRows = rows.length
  const totalAmount = rows.reduce((sum, p) => sum + (p.amountEurRounded ?? 0), 0)
  // "Gesamte Eigenmasse" in der Export-Übersicht ist bewusst die Summe der
  // vom Nutzer je Rechnung eingetragenen/gelesenen Werte ("Netto-
  // Gesamtgewicht laut Rechnung"), NICHT die Summe der berechneten
  // Positionsgewichte – so bleibt die Anzeige auch bei (noch) fehlerhafter
  // Artikelzuordnung ein verlässlicher Vergleichswert.
  const totalNetWeightFromInvoices = invoices.reduce((sum, inv) => sum + (inv.netWeightTotal ?? 0), 0)
  const totalStatisticalValue = rows.reduce((sum, p) => sum + (p.statisticalValueEurRounded ?? 0), 0)
  const manualCorrections = invoices.reduce(
    (sum, inv) =>
      sum +
      inv.manualCorrections.length +
      inv.positions.reduce((s, p) => s + p.manualCorrections.length, 0),
    0,
  )

  return {
    processedInvoices,
    generatedRows,
    totalAmount,
    totalNetWeightFromInvoices,
    totalStatisticalValue,
    manualCorrections,
  }
}
