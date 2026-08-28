# Technisches Konzept – Intrastat-Meldungs-App

Stand: 27.08.2026 (überarbeitet: Claude/Anthropic-API vollständig entfernt –
Rechnungen und die "Zusammenfassende Meldung" werden jetzt als strukturierte
Excel-Dateien eingelesen, komplett lokal im Browser. Die App ist dadurch eine
rein statische Anwendung ohne Server, API-Key oder externe Anbindung und lässt
sich z. B. über GitHub Pages hosten.)

## 0. Excel als Datenquelle, keine externe Anbindung mehr

Bis zu diesem Stand las Claude (Anthropic-API) jede Rechnung aus einer PDF
vollständig aus; das erforderte einen lokalen Proxy-Server, der den API-Key
serverseitig hielt, und machte die App zwingend von einer erreichbaren
externen API abhängig. Diese Architektur wurde bewusst aufgegeben:

- Es gibt **keine PDF-Auswertung und keine KI-Anbindung mehr** (`server/`,
  `aiVerification.ts`, `aiInvoiceBuilder.buildInvoiceFromAi` und die
  MTZ-Artikel-Zuordnungstabelle für den PDF-Weg sind entfernt).
- Rechnungen werden stattdessen als **strukturierte Excel-Datei** eingelesen
  (`lib/excelImport.ts`) – eine Zeile je Rechnungsposition, mehrere Zeilen je
  Rechnungsnummer, siehe Spaltenformat in Abschnitt 1. Das Einlesen ist
  synchron und lokal, kein Netzwerkzugriff nötig.
- Die "Zusammenfassende Meldung" (optionale Validierung vor der Prüfung, ob
  alle erwarteten Rechnungsnummern erfasst wurden) wird ebenfalls als
  Excel-Datei eingelesen (`lib/excelImport.parseExcelMeldungInvoiceNumbers`),
  nicht mehr als PDF über Claude.
- Rechnungen lassen sich weiterhin vollständig **manuell erfassen**
  (`aiInvoiceBuilder.buildManualInvoice`/`buildManualPosition`), unverändert
  gegenüber dem bisherigen Verhalten.
- Die App startet ohne jede Blockbedingung – es gibt keinen Verfügbarkeits-
  Check mehr, den ein fehlender Server oder Key scheitern lassen könnte.

Die fachlichen Berechnungsregeln (Rundung, Toleranz, statistischer Wert,
Frachtkosten-Umlage, Materialteuerungszuschlag-Zurechnung, …) sind
unverändert gültig – sie werden nur nicht mehr über einen KI-Prompt
formuliert, sondern direkt im Code (`lib/excelImport.ts`, `lib/processing.ts`,
`lib/validation.ts`).

## 1. Format der Rechnungs-Excel-Datei

| Spalte | Kürzel | Bedeutung |
|---|---|---|
| A | RENR | Rechnungsnummer (mehrere Zeilen je Rechnung = Positionen) |
| B | RGDA | Rechnungsdatum, Format `JJJJMMTT` |
| C | IDLD | Länderkennung der USt-IdNr./Bestimmungsland (`AT`, `NL`, `FR` … ; `99` = Drittland) |
| D | IDNR | USt-IdNr. des Kunden ohne Länderpräfix (bei Drittland leer) |
| E | AFHP | Positionsnummer innerhalb der Rechnung (`10`, `20`, `30`, …) |
| F | TENR | Teile-/Artikelnummer |
| G/H | BEZG | Artikelbezeichnung (zwei Zeilen) |
| I | MENG | Menge in Stück |
| J | – | Positionswert in EUR |
| K | GWNE | Nettogewicht je Stück – **ignoriert**, eigene Gewichtsliste im Tool maßgeblich |
| L | KDNR | Kundennummer |
| M/N | NAME | Kundenname (zwei Zeilen) |
| O | STRA | Straße |
| P | WORT | Ort |
| Q | ZOTA | Zolltarifnummer (8-stellig) |

Fehlende Angaben (Zolltarifnummer, Gesamt-Nettogewicht, Bestimmungsland bei
Drittland `99` mangels Lieferadresse in der Datei) bleiben leer und werden in
der Prüfansicht manuell nachgetragen – wie bei manuell erfassten Rechnungen.

**Sonderpositionen** (Artikelnummer beginnt mit `09`, keine eigene
Intrastat-Zeile, siehe `excelImport.isNonMerchandiseArticleNumber`):

- Frachtkosten/Sonderkosten (z. B. `090024`, `090025`) werden anteilig nach
  Wertanteil auf die übrigen Positionen der Rechnung umgelegt.
- Materialteuerungszuschläge (bestätigte Artikelnummern `090038`, `090039`,
  `090040`, `090041`, `090042`, `090044`, `090045`, siehe
  `excelImport.MTZ_ARTICLE_NUMBERS`) werden **immer der unmittelbar
  vorangehenden Position** zugerechnet (`excelImport.attributeMtzToPreviousPosition`)
  – unabhängig davon, zu welchem Artikel sie inhaltlich gehören und ohne
  Verifikation über eine Zuordnungstabelle, da die Positionsreihenfolge in
  der Praxis nicht zuverlässig alternierend ist.

## 2. Format der "Zusammenfassenden Meldung" (Excel)

Die Datei hat **ein Tabellenblatt je Seite** (A4) – `excelImport.parseExcelMeldungInvoiceNumbers`
durchsucht deshalb IMMER alle Tabellenblätter, nicht nur das erste. Je Blatt
gilt die erste Zeile als Kopfzeile. Feste Spalten (1-basiert): **D** (4) =
Rechnungsdatum, **F** (6) = Rechnungsnummer. Eine Zeile zählt nur, wenn beide
Spalten gefüllt sind (schließt leere bzw. Summenzeilen aus); jede
Rechnungsnummer wird nur einmal in den Abgleich übernommen, auch wenn sie
mehrfach vorkommt (mehrere Buchungszeilen derselben Rechnung).

## 3. Bestätigte fachliche Regeln (Zusammenfassung der Antworten)

Diese Regeln betreffen die Berechnung und den Export, unabhängig vom
Datenformat der Quelle:

| # | Regel | Entscheidung |
|---|---|---|
| 1 | Spalte B (Bezugsmonat) | Nur zweistellige Monatszahl `MM` (z. B. `08`), ohne Jahr |
| 2 | Gewichtsbezug | Gewichtsliste enthält Gewicht **je Stück** (in Gramm) |
| 3 | Rundung Eigenmasse (L) | Je Position **immer aufrunden** auf volle kg (kein kaufmännisches Runden) |
| 4 | Toleranz Gewichtssumme | **0 kg** – jede Abweichung sperrt die Rechnung zur manuellen Prüfung |
| 5 | Statistischer Wert (O) | Positionswert **+ anteiliger 4-%-Zuschlag** = 104 % des Positionswerts, Zuschlag wertanteilig verteilt |
| 6 | Rundung statistischer Wert | Immer aufrunden auf volle EUR |
| 7 | Zeilenbildung | Jede Rechnungsposition = eigene Excel-Zeile, keine Zusammenfassung |
| 8 | Frachtkosten | Anteilig auf Spalte N (Rechnungsbetrag) nach Wertanteil der Position verteilen; schließt alle "09"-Sonderpositionen mit ein |
| 8b | Gutschriften/Storno/Rabatte/negative Positionen | **Nie automatisch verarbeiten** – App erkennt sie (negativer Betrag), verlangt aber in jedem Fall eine manuelle Entscheidung |
| 9 | Spalte M | Immer ganze Stückzahl (Rundung falls nötig), nur bei Warennummer `39233010` |
| 10 | USt-IdNr. (P) | USt-IdNr. des Warenempfängers (Länderkennung + IDNR verkettet); muss zum Bestimmungsland passen (siehe Abschnitt 0) |
| 11 | Mustertabelle-Struktur | Leere Struktur inkl. Kopfzeile bleibt erhalten (Zeile 1 = Spaltenüberschriften, Zeile 2 = Erläuterungszeile); Datenzeilen ab Zeile 3 |
| 12 | Produktmapping | Bestätigte Zuordnungen werden **dauerhaft lokal** (Browser-Speicher) gespeichert und beim nächsten Durchlauf vorgeschlagen |
| 13 | Verarbeitungsort Einlesen | Lokal im Browser (Excel-Import bzw. manuelle Erfassung), keine externe Anbindung |
| 14 | Verarbeitungsort Berechnung | Produktzuordnung, Gewichts-/Betragsberechnungen, Validierung und Excel-Erstellung laufen ausschließlich im Browser |

**Wichtiger Hinweis zu Regel 3/4 (Transparenzpunkt):** Da jede Position einzeln
aufgerundet wird, kann die Summe der gerundeten Positionsgewichte durch
Rundungsdrift höher liegen als das Netto-Gesamtgewicht der Rechnung. Bei
Toleranz 0 kg führt das in der Praxis häufiger zu gesperrten Rechnungen. Das
ist laut Vorgabe so gewollt ("Werte dürfen nicht geraten werden").

## 4. Architektur

Rein statische Single-Page-App (React + TypeScript + Vite) – kein Server,
kein API-Key, keine externe Anbindung. Lässt sich als reiner `dist/`-Ordner
mit jedem beliebigen Webserver ausliefern, z. B. GitHub Pages.

- **Build:** Vite + React + TypeScript
- **Rechnungs-Einlesen:** `exceljs`, lokal im Browser (`lib/excelImport.ts`)
- **DOCX-Parsing (Gewichtsliste, optionaler Ersatz):** `mammoth`
- **XLSX Import/Export:** `exceljs` (erhält Formatierung, Zahlenformate, Zellentypen der Mustertabelle)
- **State:** React-Zustand, kein weiteres Backend
- **Persistenz:** `localStorage` ausschließlich für bestätigte Produkt- und Länder-Zuordnungen. Rechnungsdaten selbst werden nicht dauerhaft gespeichert.

## 5. Datenmodell (vereinfacht, TypeScript-Typen)

```ts
type Invoice = {
  id: string
  fileName: string
  language: 'de' | 'en'
  invoiceNumber?: string
  invoiceDateRaw?: string        // aus RGDA (JJJJMMTT) bzw. manuell erfasst
  referenceMonth?: string        // daraus abgeleitet, Format MM
  destinationCountry?: DestinationCountryInfo
  destinationAddressText?: string   // Kundenadresse (für Lernverhalten)
  vatId?: string
  netWeightTotal?: number        // kg, laut Rechnung (bei Excel-Import zunächst leer)
  freightCost?: number
  positions: InvoicePosition[]
  status: 'pending' | 'ok' | 'warning' | 'error'
  issues: ValidationIssue[]
}

type InvoicePosition = {
  id: string
  lineNo: number
  productNameRaw: string
  customsCode?: string            // Zolltarif-Nr., 8-stellig, als String
  quantity?: number
  amountEur?: number              // Betrag laut Rechnung (EUR)
  articleNumberRaw?: string       // z. B. "090025" für Frachtkosten-Positionen
  isTransportCost: boolean
  isMtzSurcharge: boolean
  isCreditOrDiscountOrNegative: boolean
  productMatch?: ProductMatch     // Gewichtsliste-Zuordnung
  calculatedWeightKgRounded?: number
  amountEurRounded?: number
  statisticalValueEurRounded?: number
  manualCorrections: ManualCorrection[]
  issues: ValidationIssue[]
  status: 'ok' | 'warning' | 'error'
}
```

## 6. Verarbeitungsschritte

1. **Upload & Parsen der Mustertabelle** – Header (Zeile 1) und Hinweiszeile (Zeile 2) sowie Zellformate werden geladen und für den späteren Export im Speicher gehalten, nicht verändert.
2. **Bezugsmonat wählen** – MM (+ Jahr intern für den Dateinamen/Plausibilitätsprüfung).
3. **Excel-Upload** – die Rechnungs-Excel-Datei wird sofort und vollständig lokal geparst (`excelImport.parseExcelInvoices`): Zeilen werden nach Rechnungsnummer gruppiert, Sonderpositionen klassifiziert (Frachtkosten-Umlage bzw. MTZ-Zurechnung), Bestimmungsland aus IDLD abgeleitet. Optional: Excel-Upload der "Zusammenfassenden Meldung" zum Abgleich der Rechnungsnummern.
4. **Produktzuordnung** (`productMatcher.matchProduct`) – exakter Treffer → normalisierter Treffer → manuell bestätigte Zuordnung (Sitzung oder dauerhaft) → Präfix-Treffer über den Bezeichnungsanfang → sonst nur Vorschläge zur Auswahl.
5. **Berechnungen** (`calculations.ts`):
   - Gewicht je Position = Einzelgewicht (g) × Menge ÷ 1000, je Position aufgerundet auf volle kg.
   - Gewichtssumme prüfen gegen Netto-Gesamtgewicht (Toleranz 0 kg).
   - Rechnungsbetrag je Position: Frachtkosten und der Betrag aller "09"-Sonderpositionen anteilig nach Wertanteil aufschlagen, je Position auf volle EUR aufgerundet (Spalte N).
   - Statistischer Wert je Position: 4-%-Zuschlag auf den gesamten Warenwert wertanteilig verteilt, je Position aufgerundet auf volle EUR (Spalte O).
   - Gutschrift-/Storno-/Rabatt-Positionen (negativer Betrag) werden erkannt und **immer** zur manuellen Entscheidung markiert.
6. **Validierung** (`validation.ts`) – blockiert den Export, solange offene Fehler bestehen; "09"-Sonderpositionen werden von der Warenpositions-Validierung ausgenommen.
7. **Prüfansicht** – tabellarische Übersicht, manuelle Korrekturen farblich gekennzeichnet, Änderungen protokolliert (Originalwert/neuer Wert/Zeitstempel, nur intern).
8. **Export** – `exceljs` schreibt in eine Kopie der Mustertabelle ab Zeile 3 ("09"-Sonderpositionen und Gutschriften/Storno werden nicht mitgeschrieben); Dateiname `MM-JJJJ.xlsx`.

## 7. Bibliotheken

| Zweck | Bibliothek |
|---|---|
| Rechnungs-Einlesen | exceljs, lokal im Browser |
| DOCX-Text (Gewichtsliste, optionaler Ersatz) | mammoth |
| XLSX Lesen/Schreiben | exceljs |
| UI | React + Vite |
| Tests | Vitest |
| Ähnlichkeitsvergleich (Produkt-Vorschläge) | eigene Levenshtein-Implementierung |

## 8. Datenschutz

Es findet keine Übertragung von Rechnungsdaten an Dritte statt. Alle
Verarbeitungsschritte (Einlesen, Produktzuordnung, Berechnungen,
Excel-Erstellung) laufen ausschließlich im Browser. Dauerhaft gespeichert
werden ausschließlich die bestätigten Produkt- und Länder-Zuordnungen im
`localStorage` des Nutzers.

## 9. Bekannte Grenzen

- Die Toleranz von 0 kg führt bei rundungsbedingter Drift weiterhin häufiger
  zu gesperrten Rechnungen (siehe Hinweis in Abschnitt 3).
- Ohne Lieferadresse in der Rechnungs-Excel-Datei lässt sich das
  Bestimmungsland bei Drittland (`IDLD = 99`) nicht automatisch ableiten und
  muss manuell ausgewählt werden.

---

Dieses Konzept wurde von der ursprünglichen deterministischen PDF-Auswertung
über die Claude-Anbindung hin zu einem rein lokalen Excel-Import
weiterentwickelt, um die App unabhängig von einem API-Key und als statische
Anwendung (z. B. über GitHub Pages) betreibbar zu machen.
