// Zentrale Datentypen der Intrastat-App.
// Diese Strukturen sind ausschließlich interne Hilfsdaten (siehe Anforderung
// Abschnitt 9) und erscheinen NIE als Arbeitsblatt/Spalte in der exportierten
// Excel-Datei.

export type MatchType =
  /** Treffer im hinterlegten Artikel-Gewichtsmapping (Artikelnummer). */
  | 'exact'
  /** Gewicht stand direkt in der Produktbeschreibung (z. B. "Gew.:20 g"). */
  | 'beschreibung'
  | 'manual'
  | 'none'

/** Sprache der Rechnung – steuert die erwarteten Feldbezeichnungen. */
export type InvoiceLanguage = 'de' | 'en'

/** Richtung der Rechnung = Spalte A im Export: "V" (Ausgang) oder "E" (Eingang). */
export type InvoiceDirection = 'V' | 'E'

/**
 * Firma, für die gerade eine Meldung erfasst wird (Kläger Spraying Technology
 * bzw. Kläger Performance Components). Bestimmt Farbschema, Logo und
 * Export-Dateinamen-Präfix (siehe COMPANY_THEME in App.tsx) sowie – da beide
 * Firmen fachlich getrennte Artikel-Kataloge führen – eine eigene
 * Gewichtsliste je Firma (siehe activeWeightMapStore.ts/weightListHistory.ts).
 */
export type Company = 'ST' | 'SPC'

export type DestinationCountryInfo = {
  code: string | null
  /** Woraus der Code stammt – für die Nachvollziehbarkeit in der Prüfansicht. */
  source: 'excel' | 'gelernte-zuordnung' | 'manual' | 'vat-id-override' | 'unresolved'
  isManual: boolean
  /** true, solange ein Vorschlag noch bestätigt werden muss. */
  needsConfirmation?: boolean
  /**
   * Ursprünglich ermitteltes Länderkürzel, bevor der Abgleich mit der
   * USt-IdNr. es ggf. überschrieben hat (nur zur Nachvollziehbarkeit).
   */
  overriddenAddressCode?: string | null
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
  amountEur?: number // Positionsbetrag laut Rechnung
  isSpecialUnit: boolean // Warennummer 39233010
  /**
   * Fett gesetzte Artikelnummer unter „Artikelangaben“/„Part description“,
   * über der Artikel-Bezeichnung (z. B. „090025“ für Frachtkosten).
   */
  articleNumberRaw?: string
  /**
   * Artikelnummer beginnt mit „09" (Frachtkosten, sonstige Zuschläge). Wird
   * nicht als eigene Intrastat-Zeile gemeldet, wiegt nie etwas; ihr Betrag
   * wird anteilig nach Wertanteil auf die übrigen Positionen der Rechnung
   * verteilt (Spalte N). Materialteuerungszuschlag-Positionen mit erkannter
   * zugehöriger Artikelposition fallen NICHT hierunter (siehe `isMtzSurcharge`).
   */
  isTransportCost: boolean
  /**
   * Materialteuerungszuschlag-Position, die einer vorangehenden
   * Artikelposition direkt zugerechnet wurde (siehe
   * `excelImport.attributeMtzToPreviousPosition`). Wird ebenfalls nicht als
   * eigene Intrastat-Zeile gemeldet und wiegt nichts.
   */
  isMtzSurcharge: boolean
  /** Betrag eines zugerechneten Materialteuerungszuschlags (nur an der Artikelposition gesetzt, zur Nachvollziehbarkeit). */
  mtzSurchargeEurRaw?: number
  isCreditOrDiscountOrNegative: boolean
  negativeReason?: string
  negativeDecisionMade?: boolean // true, sobald der Nutzer Gutschrift/Storno/Rabatt manuell entschieden hat
  /** true bei über „Position hinzufügen" manuell angelegten Positionen. */
  isManualEntry?: boolean

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

export type InvoiceStatus = 'pending' | 'ok' | 'warning' | 'error'

export type Invoice = {
  id: string
  fileName: string
  /** Ausgangs- oder Eingangsrechnung – bestimmt Spalte A im Export ("V"/"E"). */
  richtung: InvoiceDirection
  /** true bei vollständig manuell erfassten Rechnungen. */
  isManualEntry?: boolean

  /** Sprache der Rechnung (derzeit ohne fachliche Auswirkung, da keine PDF-Auswertung mehr stattfindet). */
  language: InvoiceLanguage
  /** Rechnungsnummer. */
  invoiceNumber?: string
  /** Rechnungsdatum. */
  invoiceDateRaw?: string
  referenceMonth?: string // MM, aus dem Rechnungsdatum abgeleitet
  referenceYear?: string // JJJJ, aus dem Rechnungsdatum abgeleitet (intern, für Plausibilität)

  destinationCountry?: DestinationCountryInfo
  /**
   * Die für das Bestimmungsland verwendete Adresse als Text. Dient zur
   * Anzeige und als Schlüssel für adressgenau gemerkte manuelle Korrekturen.
   */
  destinationAddressText?: string
  /** Welche Adresse verwendet wurde (Lieferadresse/Auftragsadresse/Empfängeradresse/Versandanschrift). */
  destinationAddressKind?: 'lieferadresse' | 'auftragsadresse' | 'empfaengeradresse' | 'versandanschrift'

  vatId?: string // bereinigt (ohne Leerzeichen)

  /**
   * Spalten E, G, H, I der Mustertabelle.
   * Ausgangsrechnungen: E/G immer leer, H fest "09", I fest "DE".
   * Eingangsrechnungen: F, H und O entfallen vollständig (siehe
   * `excelTemplate.buildExportRow`); G ist fest "09" (das eigene
   * Bundesland als Bestimmungsbundesland). Nur E und I werden aus der
   * Rechnung übernommen, sofern vorhanden – sonst leer und in der
   * Prüfansicht manuell einzutragen.
   */
  versendungsMitgliedstaat?: string // Spalte E
  bestimmungsBundesland?: string // Spalte G
  ursprungsBundesland?: string // Spalte H
  ursprungsland?: string // Spalte I

  netWeightTotal?: number // kg laut Rechnung
  freightCost?: number

  positions: InvoicePosition[]

  calculatedWeightSumRaw?: number
  calculatedWeightSumRounded?: number
  weightDifferenceKg?: number
  /**
   * Nutzer hat eine von 0 kg abweichende Differenz zwischen berechnetem und
   * ausgewiesenem Gewicht ausdrücklich akzeptiert ("Toleranz bestätigen").
   * Ändert keine Artikelgewichte oder sonstigen Regeln, hebt nur die
   * Export-Sperre für diese Differenz auf.
   */
  weightToleranceAccepted?: boolean

  manualCorrections: ManualCorrection[]
  issues: ValidationIssue[]
  status: InvoiceStatus
}

export type ManualProductMapping = Record<string, ProductWeightEntry>
