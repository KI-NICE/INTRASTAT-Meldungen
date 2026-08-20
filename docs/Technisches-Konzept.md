# Technisches Konzept – Intrastat-Meldungs-App

Stand: 20.08.2026 (überarbeitet nach den fachlichen Korrekturen zu
Bestimmungsland, Produktmapping, Rechnungsdatum, Netto-Gesamtgewicht, Menge
und hinterlegten Grunddaten).

## 0. Nachgeschärfte Erkennungs- und Zuordnungsregeln

| Thema | Festlegung |
|---|---|
| Bestimmungsland (Spalte F) | Aus dem **Länderkennzeichen vor der Postleitzahl** der Lieferadresse, ersatzweise der Auftragsadresse: `A` → `AT`, `B` → `BE`, `D` → `DE`, `F` → `FR`, `I` → `IT`, `E` → `ES`, `L` → `LU`, `S` → `SE`, `H` → `HU`, `P` → `PT`, `SLO` → `SI` usw. Ist das Kennzeichen unbekannt, fragt die App nach und speichert die bestätigte Zuordnung dauerhaft. |
| Produktzuordnung | Zusätzlich zur exakten und normalisierten Zuordnung wird ein **eindeutiger Treffer über den Bezeichnungsanfang** akzeptiert (z. B. „Sprayer K2 rot mit Kappe“ → „Sprayer K2“ = 50 g). Der längste passende Eintrag gewinnt, damit „DPZ Profi 1.5L C+ blau“ nicht auf „DPZ Profi 1.5L“ fällt; Abgrenzung an Wortgrenzen verhindert „Sprayer K20“ → „Sprayer K2“. Bestätigte Zuordnungen werden dauerhaft gespeichert. |
| Rechnungsdatum / Bezugsmonat | Aus dem Feld `vom:` **direkt unter der Rechnungsnummer**. Felder wie `Ihr Auftrag vom:`, `Bestellung vom:` und `Lieferschein vom:` werden ausdrücklich ausgeschlossen. |
| Netto-Gesamtgewicht | Aus der Fußzeile hinter der Sternchen-Trennlinie, beschriftet mit `Net weight:` bzw. `Netto:`. Ein Netto-*Geldbetrag* wird nicht damit verwechselt (Prüfung der Einheit). |
| Menge | Je Position im Format `#.###,## Stück` (deutsches Zahlenformat mit Tausenderpunkt). |
| Grunddaten | Gewichtsliste (`src/data/gewichtsliste.ts`) und Mustertabelle (`src/assets/Mustertabelle.xlsx`) sind **fest im Anwendungspaket hinterlegt** und werden nicht hochgeladen. |

## 1. Bestätigte fachliche Regeln (Zusammenfassung der Antworten)

| # | Regel | Entscheidung |
|---|---|---|
| 1 | Spalte B (Bezugsmonat) | Nur zweistellige Monatszahl `MM` (z. B. `08`), ohne Jahr – bestätigt durch den Hinweistext `01, 02….` in Zeile 2 der Mustertabelle |
| 2 | Gewichtsbezug | Gewichtsliste enthält Gewicht **je Stück** (in Gramm) |
| 3 | Rundung Eigenmasse (L) | Je Position **immer aufrunden** auf volle kg (kein kaufmännisches Runden) |
| 4 | Toleranz Gewichtssumme | **0 kg** – jede Abweichung sperrt die Rechnung zur manuellen Prüfung |
| 5 | Statistischer Wert (O) | Positionswert **+ anteiliger 4-%-Zuschlag** = 104 % des Positionswerts, Zuschlag wertanteilig verteilt |
| 6 | Rundung statistischer Wert | Immer aufrunden auf volle EUR |
| 7 | Zeilenbildung | Jede Rechnungsposition = eigene Excel-Zeile, keine Zusammenfassung |
| 8 | Frachtkosten | Anteilig auf Spalte N (Rechnungsbetrag) nach Wertanteil der Position verteilen |
| 8b | Gutschriften/Storno/Rabatte/negative Positionen | **Nie automatisch verarbeiten** – App erkennt sie, verlangt aber in jedem Fall eine manuelle Entscheidung |
| 9 | Spalte M | Immer ganze Stückzahl (Rundung falls nötig), nur bei Warennummer `39233010` |
| 10 | USt-IdNr. (P) | „Ihre USt-IdNr.“ = USt-IdNr. des Warenempfängers, immer verwendbar (nur Leerzeichen entfernen) |
| 11 | Mustertabelle-Struktur | Leere Struktur inkl. Kopfzeile bleibt erhalten (Zeile 1 = Spaltenüberschriften, Zeile 2 = Erläuterungs-/Hinweiszeile laut Vorlage); Datenzeilen werden ab Zeile 3 angehängt |
| 12 | Produktmapping | Bestätigte Zuordnungen werden **dauerhaft lokal** (Browser-Speicher) gespeichert und beim nächsten Durchlauf vorgeschlagen |
| 13 | PDF-Typ | Überwiegend textbasiert, vereinzelt gescannt → OCR-Fallback erforderlich |
| 14 | Verarbeitungsort | Backend für OCR wäre erlaubt; aus Datenschutz- und Deployment-Gründen (GitHub Pages, keine Übertragung vertraulicher Rechnungsdaten) wird OCR **clientseitig im Browser** umgesetzt (Tesseract.js/WASM). Ein Backend ist damit nicht nötig – die App bleibt vollständig statisch hostbar. |

**Wichtiger Hinweis zu Regel 3/4 (Transparenzpunkt):** Da jede Position einzeln
aufgerundet wird, kann die Summe der gerundeten Positionsgewichte durch
Rundungsdrift höher liegen als das Netto-Gesamtgewicht der Rechnung. Bei
Toleranz 0 kg führt das in der Praxis häufiger zu gesperrten Rechnungen. Das
ist laut Vorgabe so gewollt ("Werte dürfen nicht geraten werden"). Die App
vergleicht die **Summe der bereits gerundeten Positionsgewichte** (= exakt das,
was in Spalte L exportiert wird) mit dem Netto-Gesamtgewicht der Rechnung und
zeigt zusätzlich die ungerundete Summe zur Nachvollziehbarkeit an.

## 2. Architektur

Single-Page-App, rein clientseitig, deploybar auf GitHub Pages.

- **Build:** Vite + React + TypeScript
- **PDF-Textextraktion:** `pdfjs-dist`
- **OCR-Fallback:** `tesseract.js` (Sprache `deu`), nur wenn eine Seite keinen extrahierbaren Text liefert
- **DOCX-Parsing (Gewichtsliste):** `mammoth` (Rohtext) + eigener Parser für die tabulator-getrennten Zeilen (`Produkt \t Gewicht \t Zusatz`)
- **XLSX Import/Export:** `exceljs` (erhält Formatierung, Zahlenformate, Zellentypen der Mustertabelle)
- **State:** React Context/Reducer, kein Backend, kein externer Netzwerkzugriff zur Laufzeit außer dem initialen Laden der Bibliotheken
- **Persistenz:** `localStorage` ausschließlich für bestätigte Produkt-Zuordnungen (Produktname → Gewichtslisten-Eintrag). Keine Rechnungsdaten werden dauerhaft gespeichert; der Verarbeitungszustand existiert nur im Speicher der laufenden Sitzung.

## 3. Datenmodell (vereinfacht, TypeScript-Typen)

```ts
type Invoice = {
  id: string
  fileName: string
  rawText: string
  ocrUsed: boolean
  invoiceNumber?: string
  invoiceDate?: string        // erkanntes "Vom:"-Datum
  referenceMonth?: string     // daraus abgeleitet, Format MM
  recipient?: Address
  deliveryAddress?: Address   // falls abweichend angegeben
  destinationCountry?: { code: string; source: 'delivery'|'recipient'|'manual'; confidence: 'high'|'low' }
  vatId?: string
  netWeightTotal?: number     // kg, laut Rechnung
  goodsValueTotal?: number    // EUR, Summe Positionswerte
  freightCost?: number
  positions: InvoicePosition[]
  status: 'ok' | 'warning' | 'error' | 'locked'
  issues: ValidationIssue[]
}

type InvoicePosition = {
  id: string
  lineNo: number
  productNameRaw: string
  customsCode?: string        // Zolltarif-Nr., 8-stellig, als String
  quantity?: number
  unitAmount?: number         // Betrag laut Rechnung (EUR)
  isCreditOrDiscountOrNegative: boolean
  matchedProduct?: { name: string; unitWeightGrams: number; matchType: 'exact'|'normalized'|'manual'|'suggested' }
  calculatedWeightKgRaw?: number   // unrounded
  calculatedWeightKgRounded?: number
  amountEurRounded?: number
  statisticalValueEurRounded?: number
  manualOverrides: Record<string, { original: unknown; value: unknown; field: string; timestamp: number }>
  status: 'ok' | 'warning' | 'error'
}

type ProductWeightEntry = { name: string; unitWeightGrams: number }
type ManualProductMapping = Record<string /*normalisierter Produktname*/, ProductWeightEntry>
type ValidationIssue = { field: string; severity: 'warning'|'error'; message: string; requiresUserInput: boolean }
```

## 4. Verarbeitungsschritte

1. **Upload & Parsen der Mustertabelle** – Header (Zeile 1) und Hinweiszeile (Zeile 2) sowie Zellformate werden geladen und für den späteren Export im Speicher gehalten, nicht verändert.
2. **Upload & Parsen der Gewichtsliste** – Rohtext extrahieren, Zeilen anhand Tabulatoren in `Produkt / Gewicht / Zusatz` zerlegen, Gewichtsangaben (`g`) in Gramm normalisieren.
3. **Bezugsmonat wählen** – MM (+ Jahr intern für den Dateinamen/Plausibilitätsprüfung, auch wenn Spalte B nur MM enthält).
4. **PDF-Upload (Mehrfachauswahl/Drag&Drop)** – je Datei: Text extrahieren; wenn leer/sehr kurz → OCR (Tesseract) versuchen; bleibt Text unzureichend → Status `manuelle Prüfung erforderlich`, keine automatische Weiterverarbeitung der Zahlenwerte.
5. **Rechnungsfelder & Positionen extrahieren** – Regex-/Layout-Heuristiken für: „Vom:“, Rechnungsnummer, Rechnungsdatum, Empfänger-Adressblock, ggf. abweichende Lieferadresse, „Ihre USt-IdNr.:“, Positionstabelle (Produktbezeichnung, „Zolltarif-Nr.:“/„Zolltarif-Nr..:“, Menge, Betrag), Netto-Gesamtgewicht, Warenwert-Summe, Frachtkosten (falls ausgewiesen).
6. **Länderbestimmung** – Priorität Lieferadresse vor Empfängeradresse; Ländername → ISO-3166-1-Alpha-2 über feste Zuordnungstabelle; uneindeutig/fehlend → Pflichtfrage an Nutzer.
7. **Produktzuordnung** – exakter Treffer → normalisierter Treffer (trim, Groß/Klein, Mehrfach-Leerzeichen) → sonst nur Vorschläge (Ähnlichkeitsscore) zur Auswahl; bestätigte Zuordnung wird für den Rest des Laufs und dauerhaft (localStorage) übernommen.
8. **Berechnungen:**
   - Gewicht je Position = Einzelgewicht (g) × Menge ÷ 1000, danach je Position aufrunden auf volle kg.
   - Gewichtssumme prüfen gegen Netto-Gesamtgewicht (Toleranz 0 kg) → bei Abweichung: Rechnung sperren, Detailanzeige (siehe Abschnitt 5 der Anforderungen).
   - Rechnungsbetrag je Position: deutsches Zahlenformat parsen, Frachtkosten anteilig nach Wertanteil aufschlagen, danach je Position aufrunden auf volle EUR (Spalte N).
   - Statistischer Wert je Position: 4 %-Zuschlag auf den gesamten Warenwert wertanteilig verteilen, je Position aufrunden auf volle EUR (Spalte O).
   - Negative/Gutschrift/Rabatt-Positionen werden erkannt (negativer Betrag, Schlüsselwörter „Gutschrift“, „Storno“, „Rabatt“) und **immer** zur manuellen Entscheidung markiert, nie automatisch in die Berechnung übernommen.
9. **Validierung** (siehe Abschnitt 8 der Anforderungen) – blockiert den Export, solange offene Fehler/Warnungen bestehen.
10. **Prüfansicht** – tabellarische Übersicht mit allen in Abschnitt 7 der Anforderungen genannten Feldern, manuelle Korrekturen optisch gekennzeichnet (z. B. farblich, Icon), Änderungen protokolliert (Originalwert/neuer Wert/Zeitstempel, nur intern).
11. **Export** – `exceljs` schreibt in eine Kopie der Mustertabelle ab Zeile 3, setzt Spalte J/„Warennummer“ und weitere führende-Null-Felder explizit als Text, numerische Spalten als echte Zahlen; Dateiname `MM-JJJJ.xlsx`; vor Download eine Zusammenfassung (Anzahl Rechnungen, Zeilen, Gesamtbetrag, Gesamtmasse, Summe statistischer Wert, Anzahl manueller Korrekturen).

## 5. Bibliotheken (Vorschlag)

| Zweck | Bibliothek |
|---|---|
| PDF-Text | pdfjs-dist |
| OCR | tesseract.js |
| DOCX-Text | mammoth |
| XLSX Lesen/Schreiben | exceljs |
| UI | React + Vite |
| Tests | Vitest |
| Ähnlichkeitsvergleich (Vorschläge) | eigene Levenshtein-Implementierung (keine Abhängigkeit von Cloud-Diensten) |

## 6. Datenschutz

Es findet keine Übertragung von Rechnungs-, Gewichts- oder Excel-Daten an
externe Server statt. Alle Bibliotheken laufen im Browser (WASM/JS). Es wird
nichts dauerhaft gespeichert außer den bestätigten Produkt-Zuordnungen
(Produktname → Gewicht), die ausschließlich lokal im Browser des Nutzers
liegen und jederzeit gelöscht werden können.

## 7. Bekannte Grenzen

- Die Feld-Erkennung basiert auf den in den Anforderungen genannten
  Bezeichnungen. Abweichende Rechnungslayouts können eine Anpassung der
  Erkennungsmuster erfordern.
- OCR-Ergebnisse bei gescannten Rechnungen sind grundsätzlich unsicherer;
  solche Rechnungen werden konsequent zur manuellen Prüfung markiert, bevor
  Zahlenwerte übernommen werden.
- Die Toleranz von 0 kg führt bei rundungsbedingter Drift häufiger zu
  gesperrten Rechnungen (siehe Hinweis in Abschnitt 1).

---

Nach diesem Konzept wird nun mit der Implementierung begonnen.
