# Technisches Konzept – Intrastat-Meldungs-App

Stand: 20.08.2026 (überarbeitet: Claude ist jetzt die alleinige Quelle der
Rechnungsdaten – das bisherige deterministische PDF-Auslesen inkl. OCR wurde
ausgebaut, es gibt kein lokales Fallback mehr).

## 0. Claude als alleinige Quelle der Rechnungsdaten

Bis Version 434dc5e wertete die App Rechnungen selbst aus (Fettdruck- und
Spaltenerkennung über `pdf.js`, OCR-Fallback über `tesseract.js`) und holte
optional eine KI-Zweitmeinung ein, gegen die abgeglichen wurde. Diese
Architektur wurde bewusst aufgegeben:

- Es gibt **keine eigene PDF-Textextraktion mehr** (`pdf.js`, `documentText.ts`,
  `invoiceParser.ts` sind entfernt).
- Es gibt **kein OCR mehr** (`tesseract.js` ist entfernt).
- Claude liest jede Rechnung vollständig und verbindlich aus. Es gibt nichts,
  gegen das abgeglichen werden könnte – Abweichungen, Diskrepanz-Auflösung
  und "eigenen Wert behalten/KI-Wert übernehmen" (`aiCompare.ts`, `aiApply.ts`)
  entfallen ersatzlos.
- Ist der lokale Proxy (`server/index.mjs`) nicht erreichbar oder kein
  `ANTHROPIC_API_KEY` hinterlegt, ist die App **nicht funktionsfähig** – sie
  zeigt von Anfang an nur einen Blockbildschirm. Es gibt kein lokales
  Fallback.

Die fachlichen Erkennungsregeln (Position, Menge, Rechnungsdatum,
Bestimmungsland, Netto-Gesamtgewicht, Frachtkosten-Position 090025, …) sind
unverändert gültig – sie stehen jetzt als Anweisungen im `SYSTEM_PROMPT` und
im JSON-Schema des Werkzeugaufrufs (`RESULT_TOOL`) in `server/index.mjs`,
nicht mehr als Regex-/Layout-Heuristiken im Browser.

| Thema | Festlegung |
|---|---|
| Rechnungsnummer | Oben rechts **fett** neben der Überschrift `RECHNUNG` bzw. `INVOICE`. |
| Rechnungsdatum / Bezugsmonat | Feld `vom:` (deutsch) bzw. `dated:` (englisch). `Ihr Auftrag vom:`, `your order dated:`, `Bestellung vom:` und `Lieferschein vom:` werden ausgeschlossen. |
| Position | Linksbündige **fette** Ganzzahl (`10`, `20`, …); rechts davon beginnt die Artikelbezeichnung. |
| Menge | Ausschließlich die **fett** gesetzte Zahl (`1000 Stück`, `252 Stück`, englisch `200 pcs`). Preise pro 100 werden nie als Menge gelesen. |
| Positionsbetrag | Wert der Betragsspalte (`Betrag` deutsch, `Dly.date` englisch). |
| Bestimmungsland (Spalte F) | **Länderkennzeichen vor der Postleitzahl** der Lieferadresse, ersatzweise der Auftragsadresse, als ISO-3166-1-Alpha-2-Code. Claude gibt zusätzlich die verwendete Adresse als Volltext zurück (`destinationAddressText`), damit Korrekturen adressgenau gespeichert werden können. |
| USt-IdNr.-Abgleich | Das Länderkürzel muss zum Präfix der USt-IdNr. des Warenempfängers passen. Bei Abweichung sticht die USt-IdNr. das von Claude gelesene Land aus (`countryCodes.crosscheckDestinationCountryWithVatId`); eine manuell bestätigte Auswahl bleibt davon unberührt. |
| Mitdenkendes Länder-Mapping | Eine für genau die von Claude zurückgegebene Adresse gelernte Zuordnung hat Vorrang vor dem von Claude gelesenen Code (`aiInvoiceBuilder.resolveDestinationCountry`). Jede Bestätigung/Korrektur wird adressgenau dauerhaft gemerkt. |
| Frachtkosten-Position (Artikelnummer 090025) | Fett gesetzte Artikelnummer unter der Spaltenüberschrift „Artikelangaben"/„Part description", über der Artikelbezeichnung. Wird nicht als eigene Intrastat-Zeile gemeldet; ihr Betrag wird wie ausgewiesene Frachtkosten anteilig nach Wertanteil auf die übrigen Positionen verteilt. |
| Flaschenartikel | Bei `Zyl.`, `Zylinderflasche`, `Zylk.`, `FL`, `VK`, `Vierkant` steht das Artikelgewicht in der Produktbeschreibung (`Gew.:20 g`), von Claude als Teil der Bezeichnung wiedergegeben. Dieses Gewicht wird direkt verwendet und **nicht** über die Gewichtsliste ermittelt. |
| Produktzuordnung | Tokenweiser Abgleich des Bezeichnungsanfangs mit vereinheitlichten Schreibweisen (`1,0 L` = `1.0L`), ausgeschriebenes „Druckpumpzerstäuber" = „DPZ". Längster passender Eintrag gewinnt. |
| Manuelle Gewichtskorrektur | Ist kein Treffer eindeutig oder die hinterlegte Gewichtsliste veraltet, lässt sich das Gewicht je Stück direkt eintragen (nicht nur aus der Gewichtsliste wählen). Die Korrektur wird sowohl über die Artikelnummer als auch über die Produktbezeichnung dauerhaft gelernt (`mappingStore.saveArticleWeightMapping`/`saveManualMapping`) und schlägt bei künftigen Zuordnungen VOR den Treffern in der Gewichtsliste zu. |
| Netto-Gesamtgewicht | Fußzeile hinter der Sternchen-Trennlinie, `Net weight:` bzw. `Netto:`. |
| Sprache | Deutsche und englische Rechnungen werden von Claude automatisch unterschieden. |
| Unsichere Felder | Claude setzt nicht eindeutig lesbare Felder selbst auf `null` und benennt sie in `uncertainFields` – es wird nichts geraten. Diese Felder erscheinen als Warnung in der Prüfansicht. |
| Fehler beim Auslesen | Schlägt das Auslesen einer Rechnung fehl (Netzwerk-/API-Fehler), bleibt nur diese Rechnung leer und gesperrt; „Erneut versuchen" liest sie neu ein. |
| Grunddaten | Gewichtsliste (`src/data/gewichtsliste.ts`) und Mustertabelle (`src/assets/Mustertabelle.xlsx`) sind **fest im Anwendungspaket hinterlegt** und werden nicht hochgeladen. |

## 0b. Architektur des Claude-Zugriffs

| Aspekt | Festlegung |
|---|---|
| Rolle | Alleinige Quelle aller Rechnungsdaten. Keine Zweitmeinung, kein Abgleich. |
| Übertragene Daten | Die vollständige Rechnungs-PDF. |
| Architektur | Lokaler Proxy (`server/index.mjs`), der den API-Key aus der `.env` liest und die gebaute App ausliefert. Der Key gelangt nie in das Browser-Bundle. |
| Standardzustand | **Zwingend erforderlich.** Ohne erreichbaren Proxy mit gültigem Key zeigt die App nur einen Blockbildschirm (`App.tsx`, Zustand `aiAvailability.available === false`). |
| Modellwahl | Über `ANTHROPIC_MODEL` konfigurierbar; ohne Angabe wählt der Proxy das neueste verfügbare Sonnet-Modell des Kontos. |
| Strukturierte Antwort | Erzwungener Werkzeugaufruf (`tool_choice`) mit JSON-Schema (`RESULT_TOOL`), damit die Antwort maschinell weiterverarbeitet werden kann. |
| Verfügbarkeit | Erfordert ein Hosting-Ziel mit Node-Server-Betrieb; ein reines Static-Hosting wie GitHub Pages scheidet aus, da dort kein Proxy laufen kann. |
| Test ohne Datenübertragung | `e2e/mock-anthropic.mjs` bildet die API nach, sodass der gesamte Weg ohne echten Key und ohne echte Rechnungsdaten geprüft werden kann. |

## 1. Bestätigte fachliche Regeln (Zusammenfassung der Antworten)

Diese Regeln sind unabhängig davon, wer die Rechnung liest, weiterhin
gültig – sie betreffen die Berechnung und den Export, nicht das Auslesen:

| # | Regel | Entscheidung |
|---|---|---|
| 1 | Spalte B (Bezugsmonat) | Nur zweistellige Monatszahl `MM` (z. B. `08`), ohne Jahr |
| 2 | Gewichtsbezug | Gewichtsliste enthält Gewicht **je Stück** (in Gramm) |
| 3 | Rundung Eigenmasse (L) | Je Position **immer aufrunden** auf volle kg (kein kaufmännisches Runden) |
| 4 | Toleranz Gewichtssumme | **0 kg** – jede Abweichung sperrt die Rechnung zur manuellen Prüfung |
| 5 | Statistischer Wert (O) | Positionswert **+ anteiliger 4-%-Zuschlag** = 104 % des Positionswerts, Zuschlag wertanteilig verteilt |
| 6 | Rundung statistischer Wert | Immer aufrunden auf volle EUR |
| 7 | Zeilenbildung | Jede Rechnungsposition = eigene Excel-Zeile, keine Zusammenfassung |
| 8 | Frachtkosten | Anteilig auf Spalte N (Rechnungsbetrag) nach Wertanteil der Position verteilen; schließt Frachtkosten-Positionen (Artikelnummer 090025) mit ein |
| 8b | Gutschriften/Storno/Rabatte/negative Positionen | **Nie automatisch verarbeiten** – App erkennt sie (auch über Claudes `isCreditOrDiscount`-Flag), verlangt aber in jedem Fall eine manuelle Entscheidung |
| 9 | Spalte M | Immer ganze Stückzahl (Rundung falls nötig), nur bei Warennummer `39233010` |
| 10 | USt-IdNr. (P) | „Ihre USt-IdNr." = USt-IdNr. des Warenempfängers, immer verwendbar (nur Leerzeichen entfernen); muss zum Bestimmungsland passen (siehe Abschnitt 0) |
| 11 | Mustertabelle-Struktur | Leere Struktur inkl. Kopfzeile bleibt erhalten (Zeile 1 = Spaltenüberschriften, Zeile 2 = Erläuterungszeile); Datenzeilen ab Zeile 3 |
| 12 | Produktmapping | Bestätigte Zuordnungen werden **dauerhaft lokal** (Browser-Speicher) gespeichert und beim nächsten Durchlauf vorgeschlagen |
| 13 | Verarbeitungsort Auslesen | Claude (Anthropic-API) – zwingend, kein lokales Fallback |
| 14 | Verarbeitungsort Berechnung | Produktzuordnung, Gewichts-/Betragsberechnungen, Validierung und Excel-Erstellung laufen weiterhin ausschließlich im Browser |

**Wichtiger Hinweis zu Regel 3/4 (Transparenzpunkt):** Da jede Position einzeln
aufgerundet wird, kann die Summe der gerundeten Positionsgewichte durch
Rundungsdrift höher liegen als das Netto-Gesamtgewicht der Rechnung. Bei
Toleranz 0 kg führt das in der Praxis häufiger zu gesperrten Rechnungen. Das
ist laut Vorgabe so gewollt ("Werte dürfen nicht geraten werden").

## 2. Architektur

Single-Page-App (React + TypeScript + Vite) mit zwingend erforderlichem
lokalen Proxy für die Claude-Anbindung – nicht mehr ohne Weiteres als rein
statische Seite betreibbar.

- **Build:** Vite + React + TypeScript
- **Rechnungs-Auslesen:** Anthropic-API (Claude), über `server/index.mjs`
- **DOCX-Parsing (Gewichtsliste, optionaler Ersatz):** `mammoth`
- **XLSX Import/Export:** `exceljs` (erhält Formatierung, Zahlenformate, Zellentypen der Mustertabelle)
- **State:** React Context/Reducer, kein weiteres Backend
- **Persistenz:** `localStorage` ausschließlich für bestätigte Produkt- und Länder-Zuordnungen. Rechnungsdaten selbst werden nicht dauerhaft gespeichert.

## 3. Datenmodell (vereinfacht, TypeScript-Typen)

```ts
type Invoice = {
  id: string
  fileName: string
  language: 'de' | 'en'
  invoiceNumber?: string
  invoiceDateRaw?: string        // von Claude gelesenes "Vom:"-Datum
  referenceMonth?: string        // daraus abgeleitet, Format MM
  destinationCountry?: DestinationCountryInfo
  destinationAddressText?: string   // von Claude zurückgegebene Adresse (für Lernverhalten)
  destinationAddressKind?: 'lieferadresse' | 'auftragsadresse' | 'empfaengeradresse'
  vatId?: string
  netWeightTotal?: number        // kg, laut Rechnung
  freightCost?: number
  positions: InvoicePosition[]
  status: 'pending' | 'analyzing' | 'ok' | 'warning' | 'error' | 'locked'
  issues: ValidationIssue[]
  ai?: AiExtractionInfo          // Status des Auslesens durch Claude
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
  isCreditOrDiscountOrNegative: boolean
  matchedProduct?: ProductMatch   // Gewichtsliste-Zuordnung (lokal, nicht von Claude)
  calculatedWeightKgRounded?: number
  amountEurRounded?: number
  statisticalValueEurRounded?: number
  manualCorrections: ManualCorrection[]
  issues: ValidationIssue[]
  status: 'ok' | 'warning' | 'error'
}

type AiExtractionInfo = {
  status: 'fertig' | 'fehler'
  model?: string
  uncertainFields: string[]
  error?: string
}
```

## 4. Verarbeitungsschritte

1. **Upload & Parsen der Mustertabelle** – Header (Zeile 1) und Hinweiszeile (Zeile 2) sowie Zellformate werden geladen und für den späteren Export im Speicher gehalten, nicht verändert.
2. **Bezugsmonat wählen** – MM (+ Jahr intern für den Dateinamen/Plausibilitätsprüfung).
3. **PDF-Upload (Mehrfachauswahl/Drag&Drop)**.
4. **Auslesen durch Claude** – je Datei wird die vollständige PDF an den lokalen Proxy und von dort an die Anthropic-API übertragen (`readInvoiceWithAi`). Schlägt das fehl, bleibt die Rechnung leer und gesperrt (`buildInvoiceFromAi` mit `error`), ohne die übrige Verarbeitung zu blockieren.
5. **Rechnungsmodell aufbauen** (`aiInvoiceBuilder.buildInvoiceFromAi`) – Kopf- und Positionsfelder aus den von Claude gelesenen Daten übernehmen; Bezugsmonat aus dem Rechnungsdatum ableiten; Bestimmungsland über gelernte Adress-Zuordnung bzw. Claudes Code bestimmen.
6. **USt-IdNr.-Abgleich** (`countryCodes.crosscheckDestinationCountryWithVatId`) – weicht das Länderpräfix der USt-IdNr. vom Bestimmungsland ab, gewinnt die USt-IdNr.
7. **Produktzuordnung** (`productMatcher.matchProduct`) – exakter Treffer → normalisierter Treffer → manuell bestätigte Zuordnung (Sitzung oder dauerhaft) → Präfix-Treffer über den Bezeichnungsanfang → sonst nur Vorschläge zur Auswahl.
8. **Berechnungen** (`calculations.ts`):
   - Gewicht je Position = Einzelgewicht (g) × Menge ÷ 1000, je Position aufgerundet auf volle kg.
   - Gewichtssumme prüfen gegen Netto-Gesamtgewicht (Toleranz 0 kg).
   - Rechnungsbetrag je Position: Frachtkosten **und** der Betrag aller Frachtkosten-Positionen (Artikelnummer 090025) anteilig nach Wertanteil aufschlagen, je Position auf volle EUR aufgerundet (Spalte N).
   - Statistischer Wert je Position: 4-%-Zuschlag auf den gesamten Warenwert wertanteilig verteilt, je Position aufgerundet auf volle EUR (Spalte O).
   - Gutschrift-/Storno-/Rabatt-Positionen (negativer Betrag, Schlüsselwörter oder Claudes `isCreditOrDiscount`-Flag) werden erkannt und **immer** zur manuellen Entscheidung markiert.
9. **Validierung** (`validation.ts`) – blockiert den Export, solange offene Fehler bestehen; Frachtkosten-Positionen werden von der Warenpositions-Validierung ausgenommen.
10. **Prüfansicht** – tabellarische Übersicht, manuelle Korrekturen farblich gekennzeichnet, Änderungen protokolliert (Originalwert/neuer Wert/Zeitstempel, nur intern).
11. **Export** – `exceljs` schreibt in eine Kopie der Mustertabelle ab Zeile 3 (Frachtkosten-Positionen und Gutschriften/Storno werden nicht mitgeschrieben); Dateiname `MM-JJJJ.xlsx`.

## 5. Bibliotheken

| Zweck | Bibliothek |
|---|---|
| Rechnungs-Auslesen | Anthropic-API (Claude), über `server/index.mjs` |
| DOCX-Text (Gewichtsliste, optionaler Ersatz) | mammoth |
| XLSX Lesen/Schreiben | exceljs |
| UI | React + Vite |
| Tests | Vitest |
| Ähnlichkeitsvergleich (Produkt-Vorschläge) | eigene Levenshtein-Implementierung |

## 6. Datenschutz

Claude liest **jede** hochgeladene Rechnung vollständig aus – die vollständige
PDF wird dafür immer an die Anthropic-API übertragen; das ist keine optionale
Funktion mehr. Alle übrigen Verarbeitungsschritte (Produktzuordnung,
Berechnungen, Excel-Erstellung) laufen weiterhin im Browser, ohne zusätzliche
Datenübertragung. Der API-Key bleibt ausschließlich auf dem lokalen Proxy.
Dauerhaft gespeichert werden ausschließlich die bestätigten Produkt- und
Länder-Zuordnungen im `localStorage` des Nutzers.

## 7. Bekannte Grenzen

- Claude ist die alleinige Quelle der Rechnungsdaten. Ohne erreichbaren Proxy
  mit gültigem API-Key ist die App nicht funktionsfähig.
- Die Erkennungsgenauigkeit hängt von Claudes Lesefähigkeit ab, nicht mehr von
  eigenen Regex-/Layout-Heuristiken. Jeder Wert bleibt editierbar; von Claude
  selbst gemeldete Unsicherheiten erscheinen als Warnung.
- Die Toleranz von 0 kg führt bei rundungsbedingter Drift weiterhin häufiger
  zu gesperrten Rechnungen (siehe Hinweis in Abschnitt 1).
- Es gibt bewusst kein GitHub-Pages-Deployment: Ein reines Static-Hosting kann
  den Proxy nicht betreiben, die App wäre dort nicht funktionsfähig.

---

Nach diesem Konzept wurde ursprünglich implementiert; die deterministische
PDF-Auswertung wurde seither vollständig durch das Auslesen über Claude
ersetzt.
