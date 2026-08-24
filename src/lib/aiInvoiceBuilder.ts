import type { AiInvoiceFields, DestinationCountryInfo, Invoice, InvoiceDirection, InvoicePosition } from '../types'
import { lookupAddressCountryOverride } from './mappingStore'
import { MTZ_ARTIKEL_MAPPING } from '../data/mtzArtikelMapping'

/**
 * Baut das interne Rechnungs-/Positionsmodell ausschließlich aus den von
 * Claude gelesenen Feldern auf. Claude ist die einzige Quelle der
 * Rechnungsdaten – es gibt keine eigene, deterministische PDF-Auswertung
 * mehr, gegen die abgeglichen werden könnte.
 */

/**
 * Artikelnummern mit dem Präfix "09" sind grundsätzlich keine Warenpositionen
 * (Frachtkosten, sonstige Zuschläge): Sie wiegen nie etwas, werden nicht als
 * eigene Intrastat-Zeile gemeldet, und ihr Betrag wird anteilig nach
 * Wertanteil auf die übrigen (echten) Positionen der Rechnung umgelegt.
 * Artikelnummer 090025 (Frachtkosten) ist der wichtigste, aber nicht einzige
 * Fall dieser Gruppe.
 *
 * Materialteuerungszuschlag-Positionen (siehe `MTZ_ARTIKEL_MAPPING`) beginnen
 * ebenfalls mit "09", werden aber NICHT anteilig verteilt, sondern – wenn die
 * erwartete Folgeposition erkannt wird – direkt der zugehörigen
 * Artikelposition zugerechnet (siehe `classifyNonMerchandisePositions`).
 */
export function isNonMerchandiseArticleNumber(articleNumberRaw: string | undefined): boolean {
  return !!articleNumberRaw && articleNumberRaw.startsWith('09')
}

/**
 * Erlaubt die Eingabe eines Rechnungsdatums auch als reine Ziffernfolge ohne
 * Punkte, z. B. "01072026" oder "010726" (Tag/Monat/2- oder 4-stelliges
 * Jahr), und wandelt sie automatisch ins Format TT.MM.JJJJ um. Enthält die
 * Eingabe bereits Punkte oder ist sie keine reine 6- bzw. 8-stellige
 * Ziffernfolge, bleibt sie unverändert (dann tippt der Nutzer noch).
 */
export function normalizeInvoiceDateInput(raw: string): string {
  const trimmed = raw.trim()
  if (!/^\d{6}$|^\d{8}$/.test(trimmed)) return raw
  const day = trimmed.slice(0, 2)
  const month = trimmed.slice(2, 4)
  const year = trimmed.length === 8 ? trimmed.slice(4, 8) : `20${trimmed.slice(4, 6)}`
  return `${day}.${month}.${year}`
}

/**
 * Löst ein mit Schrägstrichen geschriebenes Datum ("TT/MM/JJJJ" ODER
 * "MM/TT/JJJJ" – auf der Rechnung nicht unterscheidbar) sinngemäß anhand des
 * gewählten Bezugsmonats auf und gibt es im Format TT.MM.JJJJ zurück. Punkt-
 * getrennte Daten gelten bereits als eindeutig (TT.MM.JJJJ) und werden nicht
 * angefasst.
 *
 * Stimmt genau eine der beiden Lesarten mit dem gewählten Bezugsmonat
 * überein, gewinnt diese. Sind beide oder keine der Lesarten möglich (z. B.
 * weil noch kein Bezugsmonat gewählt wurde), wird nach europäischer
 * Konvention TT/MM/JJJJ angenommen – außer diese Lesart ergäbe einen
 * ungültigen Monat (>12), dann wird auf MM/TT/JJJJ ausgewichen.
 */
export function resolveAmbiguousDateFormat(dateRaw: string | undefined, selectedMonth?: string): string | undefined {
  if (!dateRaw) return dateRaw
  const match = dateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return dateRaw

  const first = match[1].padStart(2, '0')
  const second = match[2].padStart(2, '0')
  let year = match[3]
  if (year.length === 2) year = `20${year}`

  const asDayMonth = { day: first, month: second } // TT/MM/JJJJ
  const asMonthDay = { day: second, month: first } // MM/TT/JJJJ
  const dayMonthValid = Number(asDayMonth.month) >= 1 && Number(asDayMonth.month) <= 12
  const monthDayValid = Number(asMonthDay.month) >= 1 && Number(asMonthDay.month) <= 12

  let chosen = asDayMonth
  if (selectedMonth && asDayMonth.month === selectedMonth && asMonthDay.month !== selectedMonth) {
    chosen = asDayMonth
  } else if (selectedMonth && asMonthDay.month === selectedMonth && asDayMonth.month !== selectedMonth) {
    chosen = asMonthDay
  } else if (!dayMonthValid && monthDayValid) {
    chosen = asMonthDay
  }

  return `${chosen.day}.${chosen.month}.${year}`
}

/** Leitet Monat und Jahr (Bezugsmonat) aus dem Rechnungsdatum (TT.MM.JJJJ) ab. */
export function deriveReferencePeriod(dateRaw: string | undefined): { month: string; year: string } | undefined {
  if (!dateRaw) return undefined
  const parts = dateRaw.split('.')
  if (parts.length !== 3) return undefined
  const month = parts[1].trim().padStart(2, '0')
  let year = parts[2].trim()
  if (year.length === 2) year = `20${year}`
  if (!/^\d{2}$/.test(month) || !/^\d{4}$/.test(year)) return undefined
  return { month, year }
}

/**
 * Bestimmt das Bestimmungsland: Eine bereits für genau diese Adresse
 * gelernte Zuordnung hat Vorrang vor dem von Claude gelesenen Code (siehe
 * adressgenaues Lernverhalten in `mappingStore.ts`). Der Abgleich mit der
 * USt-IdNr. erfolgt separat (siehe `countryCodes.crosscheckDestinationCountryWithVatId`).
 */
export function resolveDestinationCountry(
  aiCode: string | null | undefined,
  addressText: string | null | undefined,
): DestinationCountryInfo {
  const learned = lookupAddressCountryOverride(addressText)
  if (learned) {
    return { code: learned, source: 'gelernte-zuordnung', isManual: false, needsConfirmation: false }
  }
  if (aiCode) {
    return { code: aiCode, source: 'ai', isManual: false, needsConfirmation: false }
  }
  return { code: null, source: 'unresolved', isManual: false, needsConfirmation: true }
}

type AiPositionField = NonNullable<AiInvoiceFields['positions']>[number]

function buildPosition(raw: AiPositionField, index: number): InvoicePosition {
  const customsCode = raw.customsCode?.replace(/\D/g, '') || undefined
  const articleNumberRaw = raw.articleNumber?.trim() || undefined
  const isTransportCost = isNonMerchandiseArticleNumber(articleNumberRaw)
  const amountEur = raw.amountEur ?? undefined
  const isNegativeAmount = amountEur != null && amountEur < 0
  const isCreditOrDiscountOrNegative = !isTransportCost && (raw.isCreditOrDiscount === true || isNegativeAmount)

  return {
    id: `pos-${index + 1}-${raw.positionNumber ?? index + 1}`,
    lineNo: index + 1,
    positionNumber: raw.positionNumber ?? undefined,
    productNameRaw: raw.productDescription ?? '',
    customsCodeRaw: raw.customsCode ?? undefined,
    customsCode,
    quantityRaw: raw.quantity != null ? String(raw.quantity) : undefined,
    quantity: raw.quantity ?? undefined,
    amountRaw: amountEur != null ? String(amountEur) : undefined,
    amountEur,
    isSpecialUnit: customsCode === '39233010',
    articleNumberRaw,
    isTransportCost,
    isMtzSurcharge: false,
    isCreditOrDiscountOrNegative,
    negativeReason: raw.isCreditOrDiscount === true ? 'von Claude als Gutschrift/Storno/Rabatt erkannt' : undefined,
    manualCorrections: [],
    issues: [],
    status: 'ok',
    requiresManualDecision: isCreditOrDiscountOrNegative,
  }
}

/**
 * Erkennt Materialteuerungszuschlag-Positionen anhand von
 * `MTZ_ARTIKEL_MAPPING` und rechnet ihren Betrag der jeweils vorangehenden
 * Artikelposition zu (Reihenfolge auf der Rechnung in aller Regel:
 * Artikelposition, MTZ-Position, Artikelposition, MTZ-Position, …).
 *
 * Eine erkannte MTZ-Position wird nicht mehr anteilig auf alle Positionen
 * verteilt (`isTransportCost`), sondern ausschließlich der einen zugehörigen
 * Artikelposition direkt zugerechnet (`isMtzSurcharge`). Passt die
 * Reihenfolge in Einzelfällen nicht (z. B. Artikel ohne direkt folgende
 * MTZ-Position), bleibt die Position als allgemeine "09"-Position stehen und
 * wird wie Frachtkosten anteilig verteilt – es wird nichts verworfen.
 */
function classifyNonMerchandisePositions(positions: InvoicePosition[]): InvoicePosition[] {
  const result = positions.map((p) => ({ ...p }))

  for (let i = 0; i < result.length - 1; i++) {
    const parent = result[i]
    if (parent.isTransportCost || parent.isCreditOrDiscountOrNegative) continue
    if (!parent.articleNumberRaw) continue

    const expectedMtzArticle = MTZ_ARTIKEL_MAPPING[parent.articleNumberRaw]
    if (!expectedMtzArticle) continue

    const candidate = result[i + 1]
    if (!candidate.isTransportCost || candidate.articleNumberRaw !== expectedMtzArticle) continue

    candidate.isTransportCost = false
    candidate.isMtzSurcharge = true
    parent.mtzSurchargeEurRaw = candidate.amountEur ?? 0
    parent.amountEur = (parent.amountEur ?? 0) + (candidate.amountEur ?? 0)
  }

  return result
}

/**
 * Baut die Rechnung aus dem Ergebnis von `readInvoiceWithAi` auf. `result`
 * ist `null`, wenn das Auslesen dieser Rechnung fehlgeschlagen ist – dann
 * bleibt die Rechnung leer und gesperrt (`status: 'error'`), mit der
 * Fehlermeldung in `ai.error`.
 */
export function buildInvoiceFromAi(
  id: string,
  fileName: string,
  richtung: InvoiceDirection,
  result: { model: string; fields: AiInvoiceFields } | null,
  error?: string,
): Invoice {
  if (!result) {
    return {
      id,
      fileName,
      richtung,
      language: 'de',
      positions: [],
      manualCorrections: [],
      issues: [],
      status: 'error',
      ai: { status: 'fehler', uncertainFields: [], error: error ?? 'Unbekannter Fehler' },
    }
  }

  const { model, fields } = result
  const period = deriveReferencePeriod(fields.invoiceDate ?? undefined)
  const destinationCountry = resolveDestinationCountry(fields.destinationCountryCode, fields.destinationAddressText)
  const positions = classifyNonMerchandisePositions((fields.positions ?? []).map((p, index) => buildPosition(p, index)))
  const columnsEGHI = resolveColumnsEGHI(richtung, fields)

  return {
    id,
    fileName,
    richtung,
    language: fields.language === 'en' ? 'en' : 'de',
    invoiceNumber: fields.invoiceNumber ?? undefined,
    invoiceDateRaw: fields.invoiceDate ?? undefined,
    referenceMonth: period?.month,
    referenceYear: period?.year,
    destinationCountry,
    destinationAddressText: fields.destinationAddressText ?? undefined,
    destinationAddressKind: fields.destinationAddressUsed ?? undefined,
    vatId: fields.vatId?.replace(/\s+/g, '') ?? undefined,
    netWeightTotal: fields.netWeightTotalKg ?? undefined,
    freightCost: fields.freightCostEur ?? undefined,
    ...columnsEGHI,
    positions,
    manualCorrections: [],
    issues: [],
    status: 'pending',
    ai: {
      status: 'fertig',
      model,
      // "netWeightTotalKg" und "freightCostEur" werden bewusst nie als
      // unsicheres Feld gemeldet: Das Netto-Gesamtgewicht wird zusätzlich
      // über die Gewichtssummen-Prüfung (siehe validation.ts) abgesichert,
      // die Frachtkosten fließen ohnehin nur anteilig in Spalte N ein –
      // zusätzliche Unsicherheits-Meldungen dafür wären nur Rauschen. Bei
      // Eingangsrechnungen sind "destinationCountryCode"/"destinationAddressUsed"
      // irrelevant (Spalte F entfällt dort), entsprechende Meldungen wären
      // ebenfalls nur Rauschen.
      uncertainFields: (fields.uncertainFields ?? []).filter(
        (f) =>
          typeof f === 'string' &&
          f.trim().length > 0 &&
          f !== 'netWeightTotalKg' &&
          f !== 'freightCostEur' &&
          !(richtung === 'E' && (f === 'destinationCountryCode' || f === 'destinationAddressUsed')),
      ),
    },
  }
}

/**
 * Bestimmt die Werte für die Mustertabellen-Spalten E, G, H, I.
 *
 * Ausgangsrechnungen: E/G immer leer, H fest "09" (Ursprungsbundesland des
 * Unternehmens), I fest "DE".
 *
 * Eingangsrechnungen: F, H und O entfallen vollständig (siehe
 * `excelTemplate.buildExportRow`); G ist fest "09" (Bestimmungsbundesland =
 * das eigene Bundesland, spiegelbildlich zu H bei Ausgangsrechnungen). Nur E
 * (Versendungsmitgliedstaat) und I (Ursprungsland) werden weiterhin von
 * Claude gelesen bzw. sind sonst in der Prüfansicht manuell einzutragen.
 */
function resolveColumnsEGHI(
  richtung: InvoiceDirection,
  fields: AiInvoiceFields,
): Pick<Invoice, 'versendungsMitgliedstaat' | 'bestimmungsBundesland' | 'ursprungsBundesland' | 'ursprungsland'> {
  if (richtung === 'V') {
    return { versendungsMitgliedstaat: '', bestimmungsBundesland: '', ursprungsBundesland: '09', ursprungsland: 'DE' }
  }
  return {
    versendungsMitgliedstaat: fields.versendungsmitgliedstaatCode?.trim() || undefined,
    bestimmungsBundesland: '09',
    ursprungsBundesland: '',
    ursprungsland: fields.ursprungslandCode?.trim() || undefined,
  }
}

/** Baut eine leere Rechnung für die vollständig manuelle Erfassung auf (kein Claude-Auslesen). */
export function buildManualInvoice(id: string, richtung: InvoiceDirection): Invoice {
  return {
    id,
    fileName: 'Manuell erfasst',
    richtung,
    isManualEntry: true,
    language: 'de',
    ...(richtung === 'V'
      ? { versendungsMitgliedstaat: '', bestimmungsBundesland: '', ursprungsBundesland: '09', ursprungsland: 'DE' }
      : { bestimmungsBundesland: '09', ursprungsBundesland: '' }),
    positions: [],
    manualCorrections: [],
    issues: [],
    status: 'pending',
  }
}

let manualPositionCounter = 0

/**
 * Erzeugt eine leere, manuell auszufüllende Position für eine Rechnung.
 * `positionNumber` sollte der Zehnerfolge realer Rechnungen entsprechen
 * ("10", "20", "30", …) – siehe `App.handleAddPosition`.
 */
export function buildManualPosition(positionNumber?: string): InvoicePosition {
  manualPositionCounter += 1
  return {
    id: `manual-pos-${manualPositionCounter}`,
    lineNo: manualPositionCounter,
    positionNumber,
    productNameRaw: '',
    isSpecialUnit: false,
    isTransportCost: false,
    isMtzSurcharge: false,
    isCreditOrDiscountOrNegative: false,
    isManualEntry: true,
    manualCorrections: [],
    issues: [],
    status: 'ok',
    requiresManualDecision: false,
  }
}
