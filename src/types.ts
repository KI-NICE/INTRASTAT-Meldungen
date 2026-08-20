// Zentrale Datentypen der Intrastat-App.
// Diese Strukturen sind ausschließlich interne Hilfsdaten (siehe Anforderung
// Abschnitt 9) und erscheinen NIE als Arbeitsblatt/Spalte in der exportierten
// Excel-Datei.

export type MatchType = 'exact' | 'normalized' | 'manual' | 'suggested' | 'none'

export type Address = {
  raw: string
  countryNameRaw?: string
  countryCode?: string
}

export type DestinationCountryInfo = {
  code: string | null
  source: 'delivery' | 'recipient' | 'manual' | 'unresolved'
  isManual: boolean
  candidates?: { label: string; code: string }[]
}

export type ManualCorrection = {
  field: string
  originalValue: unknown
  newValue: unknown
  timestamp: number
}

export type ValidationSeverity = 'error' | 'warning'

export type ValidationIssue = {
  id: string
  field: string
  severity: ValidationSeverity
  message: string
  resolved: boolean
}

export type ProductWeightEntry = {
  name: string
  unitWeightGrams: number
  zusatz?: string
}

export type ProductMatch = {
  matchType: MatchType
  entry: ProductWeightEntry | null
  suggestions: { entry: ProductWeightEntry; score: number }[]
}

export type InvoicePosition = {
  id: string
  lineNo: number
  productNameRaw: string
  customsCodeRaw?: string
  customsCode?: string // normalisiert, 8-stellig, als Text
  quantityRaw?: string
  quantity?: number
  amountRaw?: string
  amountEur?: number // Positionsbetrag laut Rechnung, nach Zahlenformat-Parsing
  isSpecialUnit: boolean // Warennummer 39233010
  isCreditOrDiscountOrNegative: boolean
  negativeReason?: string
  negativeDecisionMade?: boolean // true, sobald der Nutzer Gutschrift/Storno/Rabatt manuell entschieden hat

  productMatch?: ProductMatch
  calculatedWeightKgRaw?: number
  calculatedWeightKgRounded?: number

  freightShareEur?: number
  amountWithFreightEurRaw?: number
  amountEurRounded?: number // Spalte N
  statisticalSurchargeEurRaw?: number
  statisticalValueEurRounded?: number // Spalte O

  manualCorrections: ManualCorrection[]
  issues: ValidationIssue[]
  status: 'ok' | 'warning' | 'error'
  requiresManualDecision: boolean
}

export type InvoiceStatus = 'pending' | 'analyzing' | 'ok' | 'warning' | 'error' | 'locked'

export type Invoice = {
  id: string
  fileName: string
  rawText: string
  ocrUsed: boolean
  extractionFailed: boolean

  invoiceNumber?: string
  invoiceDateRaw?: string
  invoiceDate?: string // ISO yyyy-mm-dd, soweit erkennbar
  referenceMonth?: string // MM, aus "Vom:"-Feld abgeleitet
  referenceYear?: string // JJJJ, aus "Vom:"-Feld abgeleitet (intern, für Plausibilität)

  recipient?: Address
  deliveryAddress?: Address
  destinationCountry?: DestinationCountryInfo

  vatIdRaw?: string
  vatId?: string // bereinigt (ohne Leerzeichen)

  netWeightTotalRaw?: string
  netWeightTotal?: number // kg laut Rechnung
  goodsValueTotalRaw?: string
  goodsValueTotal?: number // EUR, Summe Positionswerte laut Rechnung
  freightCostRaw?: string
  freightCost?: number

  positions: InvoicePosition[]

  calculatedWeightSumRaw?: number
  calculatedWeightSumRounded?: number
  weightDifferenceKg?: number

  manualCorrections: ManualCorrection[]
  issues: ValidationIssue[]
  status: InvoiceStatus
}

export type ManualProductMapping = Record<string, ProductWeightEntry>
