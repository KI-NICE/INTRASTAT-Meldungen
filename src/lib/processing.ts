import type { AiInvoiceFields, Invoice, InvoiceDirection, InvoicePosition } from '../types'
import { readInvoiceWithAi } from './aiVerification'
import { buildInvoiceFromAi, deriveReferencePeriod, resolveAmbiguousDateFormat } from './aiInvoiceBuilder'
import { crosscheckDestinationCountryWithVatId } from './countryCodes'
import { matchProductWeight } from './productMatcher'
import { calculateAmountWithFreight, calculatePositionWeight, calculateStatisticalValues } from './calculations'
import { validateInvoice } from './validation'

let invoiceCounter = 0

/** Positionen, die weder Gutschrift/Storno/Rabatt noch reine Werteposition (Fracht/Zuschlag) sind. */
function isMerchandisePosition(position: InvoicePosition): boolean {
  return !position.isCreditOrDiscountOrNegative && !position.isTransportCost && !position.isMtzSurcharge
}

/**
 * Berechnet Produktzuordnung, Gewichte, Beträge und den statistischen Wert
 * für alle Positionen einer Rechnung neu und führt anschließend die
 * Validierung aus. Wird sowohl bei der initialen Verarbeitung als auch nach
 * jeder manuellen Korrektur in der Prüfansicht aufgerufen, damit der Zustand
 * stets konsistent bleibt.
 *
 * `weightMaps` enthält je eine eigenständige Gewichtsliste für Ausgangs- (V)
 * und Eingangsrechnungen (E) – beide Richtungen führen fachlich getrennte
 * Artikel-Kataloge (siehe mappingStore.ts).
 */
export function recalculateInvoice(
  invoice: Invoice,
  weightMaps: Record<InvoiceDirection, Record<string, number>>,
  selectedMonth: string,
  selectedYear: string,
): Invoice {
  // Mit Schrägstrich geschriebene Daten (TT/MM/JJJJ oder MM/TT/JJJJ – auf der
  // Rechnung nicht unterscheidbar) werden anhand des gewählten Bezugsmonats
  // aufgelöst und einheitlich im Format TT.MM.JJJJ dargestellt. Punkt-
  // getrennte Daten bleiben unverändert. Gilt sowohl für von Claude gelesene
  // als auch für manuell eingetragene Daten, da beide über diese Funktion
  // laufen.
  const resolvedDateRaw = resolveAmbiguousDateFormat(invoice.invoiceDateRaw, selectedMonth)
  if (resolvedDateRaw !== invoice.invoiceDateRaw) {
    const period = deriveReferencePeriod(resolvedDateRaw)
    invoice = {
      ...invoice,
      invoiceDateRaw: resolvedDateRaw,
      referenceMonth: period?.month ?? invoice.referenceMonth,
      referenceYear: period?.year ?? invoice.referenceYear,
    }
  }

  const effectiveWeightMap = weightMaps[invoice.richtung]

  const positions: InvoicePosition[] = invoice.positions.map((position) => {
    if (!isMerchandisePosition(position)) {
      return {
        ...position,
        productMatch: undefined,
        calculatedWeightKgRaw: undefined,
        calculatedWeightKgRounded: undefined,
      }
    }

    // Eine manuelle Korrektur OHNE Artikelnummer lässt sich über keine
    // Gewichtsliste erneut herleiten und bleibt deshalb dauerhaft an dieser
    // einen Position bestehen. Mit Artikelnummer wird IMMER frisch gegen die
    // aktuelle Gewichtsliste abgeglichen, damit ein Wechsel/Zurücksetzen der
    // Liste sich sofort auswirkt (siehe productMatcher.ts).
    const productMatch =
      position.productMatch?.matchType === 'manual' && !position.articleNumberRaw
        ? position.productMatch
        : matchProductWeight(position.productNameRaw, position.articleNumberRaw, effectiveWeightMap)

    let calculatedWeightKgRaw: number | undefined
    let calculatedWeightKgRounded: number | undefined
    if (productMatch.entry && position.quantity != null) {
      const weight = calculatePositionWeight(productMatch.entry.unitWeightGrams, position.quantity)
      calculatedWeightKgRaw = weight.rawKg
      calculatedWeightKgRounded = weight.roundedKg
    }

    return { ...position, productMatch, calculatedWeightKgRaw, calculatedWeightKgRounded }
  })

  // "09"-Positionen (Frachtkosten, sonstige Zuschläge – Materialteuerungs-
  // zuschläge ausgenommen, die bereits direkt der Artikelposition zugerechnet
  // wurden) werden nicht als eigene Zeile gemeldet; ihr Betrag wird anteilig
  // nach Wertanteil auf die übrigen Positionen der Rechnung verteilt.
  //
  // Gibt es eine solche Position, ist deren Betrag maßgeblich – ein
  // zusätzlich im Kopf ausgewiesener Frachtkosten-Betrag (`freightCost`)
  // wird dann NICHT addiert, da er sonst dieselben Frachtkosten ein zweites
  // Mal umlegen würde (Position + Kopf-Angabe beschreiben denselben Betrag).
  const transportCostFromPositions = positions
    .filter((p) => p.isTransportCost)
    .reduce((sum, p) => sum + (p.amountEur ?? 0), 0)
  const effectiveFreightCost = transportCostFromPositions > 0 ? transportCostFromPositions : (invoice.freightCost ?? 0)

  const relevantPositions = positions.filter(isMerchandisePosition)

  // Spalte N (Rechnungsbetrag): reiner Positionswert (inkl. ggf. zugerechnetem
  // Materialteuerungszuschlag) zzgl. anteiliger Frachtkosten/Zuschläge.
  const { roundedAmounts, rawAmounts } = calculateAmountWithFreight(
    relevantPositions,
    effectiveFreightCost || undefined,
  )

  // Spalte O (statistischer Wert): AUSSCHLIESSLICH auf Basis der reinen
  // Positionswerte OHNE Frachtkosten/Zuschläge berechnet – nur diese dürfen
  // für den 4-%-Zuschlag zusammengefasst werden.
  const pureValues = relevantPositions.map((p) => p.amountEur ?? 0)
  const { rawValues, roundedValues } = calculateStatisticalValues(pureValues)

  let idx = 0
  const positionsWithAmounts = positions.map((position) => {
    if (!isMerchandisePosition(position)) return position
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

  const destinationCountry = crosscheckDestinationCountryWithVatId(invoice.destinationCountry, invoice.vatId)

  const updatedInvoice: Invoice = { ...invoice, positions: positionsWithAmounts, destinationCountry }

  const { issues, positions: validatedPositions } = validateInvoice(updatedInvoice, selectedMonth, selectedYear)
  updatedInvoice.issues = issues
  updatedInvoice.positions = validatedPositions
  // Eine manuell bestätigte Gewichts-Toleranz-Warnung ("weightSum") hält eine
  // ansonsten fehlerfreie Rechnung nicht mehr auf "Warnung" fest – sie wird
  // grün markiert, das Badge zeigt stattdessen "Manuell bestätigt" (siehe
  // ReviewTable.tsx). Ist die Warnung dagegen nur die automatische Toleranz
  // von 1-2 kg (ohne manuelle Bestätigung) oder liegen weitere Warnungen vor,
  // bleibt die Rechnung auf "Warnung" (orange).
  const hasError = issues.some((i) => i.severity === 'error' && !i.resolved)
  const hasBlockingWarning = issues.some(
    (i) => i.severity === 'warning' && !i.resolved && !(i.field === 'weightSum' && updatedInvoice.weightToleranceAccepted),
  )
  updatedInvoice.status = hasError ? 'error' : hasBlockingWarning ? 'warning' : 'ok'

  return updatedInvoice
}

/**
 * Verarbeitet eine hochgeladene PDF-Datei vollständig: Claude liest die
 * Rechnung (einzige Quelle), anschließend folgen Produktzuordnung,
 * Berechnungen und Validierung. Schlägt das Auslesen fehl (z. B. Netzwerk-
 * oder API-Fehler), bleibt die Rechnung leer und wird zur manuellen Prüfung
 * gesperrt – es wird nichts geraten.
 */
export async function processInvoiceFile(
  file: File,
  richtung: InvoiceDirection,
  weightMaps: Record<InvoiceDirection, Record<string, number>>,
  selectedMonth: string,
  selectedYear: string,
): Promise<Invoice> {
  invoiceCounter += 1
  const id = `invoice-${invoiceCounter}-${file.name}`

  let result: { model: string; fields: AiInvoiceFields } | null = null
  let error: string | undefined

  try {
    result = await readInvoiceWithAi(file, richtung)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unbekannter Fehler'
  }

  const baseInvoice = buildInvoiceFromAi(id, file.name, richtung, result, error)
  return recalculateInvoice(baseInvoice, weightMaps, selectedMonth, selectedYear)
}
