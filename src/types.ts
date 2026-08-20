// Zentrale Datentypen der Intrastat-App.
// Diese Strukturen sind ausschließlich interne Hilfsdaten (siehe Anforderung
// Abschnitt 9) und erscheinen NIE als Arbeitsblatt/Spalte in der exportierten
// Excel-Datei.

export type MatchType =
  | 'exact'
  | 'normalized'
  | 'prefix'
  /** Gewicht stand direkt in der Produktbeschreibung (z. B. "Gew.:20 g"). */
  | 'beschreibung'
  | 'manual'
  | 'suggested'
  | 'none'

/** Sprache der Rechnung – steuert die erwarteten Feldbezeichnungen. */
export type InvoiceLanguage = 'de' | 'en'

export type AddressKind = 'delivery' | 'order' | 'recipient'

export type Address = {
  kind: AddressKind
  raw: string
  /** Im Adressblock gefundenes Länder-Token, z. B. "A", "B" oder "Belgien". */
  countryToken?: string
  countryCode?: string
}

export type DestinationCountryInfo = {
  code: string | null
  /** Woraus der Code stammt – für die Nachvollziehbarkeit in der Prüfansicht. */
  source:
    | 'delivery'
    | 'order'
    | 'recipient'
    | 'gelernte-zuordnung'
    | 'gespeichertes-mapping'
    | 'manual'
    | 'unresolved'
  isManual: boolean
  /** Token, unter dem eine manuelle Zuordnung dauerhaft gespeichert wird. */
  token?: string | null
  /** true, solange ein Vorschlag noch bestätigt werden muss. */
  needsConfirmation?: boolean
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
  /** Fortlaufende Nummer in der App (1, 2, 3 …). */
  lineNo: number
  /** Positionsnummer laut Rechnung (linksbündig fett, z. B. "10", "20"). */
  positionNumber?: string
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
  /** false, wenn kein Fettdruck erkennbar war (z. B. nach OCR). */
  hasFontInfo: boolean

  /** Erkannte Rechnungssprache (deutsche oder englische Feldbezeichnungen). */
  language: InvoiceLanguage
  /** Rechnungsnummer – oben rechts fett neben "RECHNUNG" bzw. "INVOICE". */
  invoiceNumber?: string
  /** Rechnungsdatum aus "vom:" bzw. "dated:" unter der Rechnungsnummer. */
  invoiceDateRaw?: string
  referenceMonth?: string // MM, aus dem Rechnungsdatum abgeleitet
  referenceYear?: string // JJJJ, aus dem Rechnungsdatum abgeleitet (intern, für Plausibilität)

  recipient?: Address
  /** Auftragsadresse – Rückfallebene, wenn keine Lieferadresse angegeben ist. */
  orderAddress?: Address
  deliveryAddress?: Address
  /** Adresse, die tatsächlich für das Bestimmungsland verwendet wurde. */
  usedAddress?: Address
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
