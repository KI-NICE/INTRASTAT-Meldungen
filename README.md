# Intrastat-Meldungs-App

Eine deutschsprachige Web-App zur Erstellung von Intrastat-Meldungen aus
PDF-Rechnungen. Die gesamte Verarbeitung – PDF-Auslesen, OCR-Fallback,
Gewichtszuordnung, Excel-Erstellung – läuft ausschließlich lokal im Browser.
Es werden keine Rechnungs-, Gewichts- oder Excel-Daten an einen Server
übertragen.

## Fest hinterlegte Grunddaten

Gewichtsliste und Mustertabelle sind Teil der Anwendung und müssen **nicht**
hochgeladen werden:

| Datei | Ort im Projekt | Verwendung |
| --- | --- | --- |
| Gewichtsliste (23 Produkte, Gewicht je Stück in Gramm) | `src/data/gewichtsliste.ts` | Produkt- und Gewichtszuordnung |
| Mustertabelle.xlsx | `src/assets/Mustertabelle.xlsx` | Struktur und Formatierung des Exports |

Ändert sich die Gewichtsliste dauerhaft, wird `src/data/gewichtsliste.ts`
angepasst und die App neu gebaut. Für einen einmaligen Test lässt sich die
Liste unter „Erweitert“ vorübergehend durch eine DOCX-Datei ersetzen; diese
Ersetzung gilt nur bis zum Neuladen der Seite.

## Bedienung

1. **Bezugsmonat auswählen** – Monat und Jahr. In Spalte B wird nur die
   zweistellige Monatszahl ausgegeben; das Jahr dient der Plausibilitätsprüfung
   und dem Dateinamen.
2. **PDF-Rechnungen hochladen** – Mehrfachauswahl oder Drag & Drop.
3. **Analyse starten** – Text-/OCR-Extraktion, Feld- und Positionserkennung,
   Produktzuordnung, Berechnungen und Validierung laufen automatisch.
4. **Prüfen und korrigieren** – je Rechnung eine Karte mit allen erkannten
   Kopfdaten und einer Positionstabelle. Jeder erkannte Wert ist editierbar;
   manuelle Änderungen werden gelb hervorgehoben. Über „Rohtext anzeigen“ lässt
   sich der aus der PDF gelesene Text einsehen, falls ein Feld nicht erkannt
   wurde.
5. **Vorschau** – zeigt exakt die Daten, die exportiert werden (Spalten A–P).
6. **Export** – nach Prüfung der Zusammenfassung wird `MM-JJJJ.xlsx`
   heruntergeladen. Der Export ist erst möglich, wenn keine ungeklärten Fehler
   mehr vorliegen.

## Erkennungsregeln (fachlich bestätigt)

Die Rechnungen werden nicht nur als Text, sondern mit **Fettdruck und
Spaltenpositionen** ausgewertet – ohne diese Information sind Positionsnummer,
Menge und Rechnungsnummer nicht eindeutig bestimmbar (Preise stehen "per 100").
Ist in einer PDF kein Fettdruck erkennbar (z. B. nach OCR), wird die Rechnung
gesperrt und muss vollständig manuell geprüft werden.

| Feld | Fundstelle in der Rechnung |
| --- | --- |
| Rechnungsnummer | Oben rechts **fett** neben der Überschrift `RECHNUNG` bzw. `INVOICE`. |
| Rechnungsdatum / Bezugsmonat | Feld `vom:` (deutsch) bzw. `dated:` (englisch). Felder mit anderem Bezug – `Ihr Auftrag vom:`, `your order dated:`, `Bestellung vom:`, `Lieferschein vom:` – werden ausdrücklich ignoriert. |
| Position | Linksbündige, **fette** Ganzzahl (`10`, `20`, …). Rechts davon beginnt die Artikelbezeichnung; sie wird über die Folgezeilen der Bezeichnungsspalte fortgesetzt. |
| Menge | Ausschließlich die **fett** gesetzte Zahl (`1000 Stück`, `252 Stück`, englisch `200 pcs`). Nicht-fette Zahlen wie der Preis pro 100 werden nie als Menge gelesen. |
| Positionsbetrag | Wert in der Betragsspalte – die Spalte wird über die x-Position der Kopfzeile bestimmt (`Betrag` deutsch, `Dly.date` englisch), nicht über den Zahlenwert. Datumswerte werden ausgeschlossen. |
| Bestimmungsland (Spalte F) | Länderkennzeichen vor der Postleitzahl der **Lieferadresse**, ersatzweise der **Auftragsadresse**: `A` → `AT`, `B` → `BE`, `D` → `DE`, `F` → `FR`, `I` → `IT`, `E` → `ES`, `L` → `LU`, `S` → `SE`, `H` → `HU`, `P` → `PT`, `SLO` → `SI` usw. |
| Netto-Gesamtgewicht | Fußzeile hinter der Sternchen-Trennlinie, beschriftet mit `Net weight:` oder `Netto:`. Ein Netto-*Betrag* in EUR wird nicht damit verwechselt. |
| Warennummer (Spalte J) | Feld `Zolltarif-Nr.:` / `Zolltarif-Nr..:` bzw. englisch `Customs tariff no.:` / `Commodity code`, als Text gespeichert. |
| USt-IdNr. (Spalte P) | Feld `Ihre USt-IdNr.:` bzw. `Your VAT-ID:`, Leerzeichen werden entfernt. |
| Eigenmasse (Spalte L) | Einzelgewicht × Menge, je Position auf volle kg **aufgerundet**. |
| Besondere Maßeinheit (Spalte M) | Nur bei Warennummer `39233010`, Menge als ganze Stückzahl. |
| Rechnungsbetrag (Spalte N) | Positionsbetrag, Frachtkosten anteilig nach Wertanteil aufgeschlagen, auf volle EUR aufgerundet. |
| Statistischer Wert (Spalte O) | Positionswert + anteiliger 4-%-Zuschlag (= 104 %), auf volle EUR aufgerundet. |

Feste Werte: A = `V`, C = `11`, D = `3`, H = `09`, I = `DE`; E, G und K bleiben leer.

Englische Rechnungen werden automatisch erkannt (Auswertung der
Feldbezeichnungen) und mit den englischen Beschriftungen gelesen.

## Zuordnungen und Lernverhalten

**Produkte.** Gewicht aus der Produktbeschreibung → exakter Treffer →
normalisierter Treffer → zuvor manuell bestätigte Zuordnung → eindeutiger
Treffer über den Bezeichnungsanfang. Bleibt es unklar, verlangt die App eine
Auswahl und übernimmt nichts automatisch.

- **Flaschenartikel** (`Zyl.`, `Zylinderflasche`, `Zylk.`, `FL`, `VK`,
  `Vierkant`) tragen das Artikelgewicht in der Beschreibung selbst, z. B.
  `Gew.:20 g`. Dieses Gewicht wird direkt verwendet und **nicht** über die
  Gewichtsliste ermittelt. Die Prüfansicht weist das ausdrücklich aus.
- **Fortfolgende Bezeichnungen** werden über einen tokenweisen Abgleich des
  Bezeichnungsanfangs aufgelöst: „DPZ Hobby 1,0 L natur mit Deckel“ →
  „DPZ Hobby 1.0L“ (330 g), „Sprayer K2 rot mit Kappe 28/410“ →
  „Sprayer K2“ (50 g). Schreibweisen wie `1,0 L` und `1.0L` gelten dabei als
  gleich. Der längste passende Eintrag gewinnt, damit
  „DPZ Profi 1,5 L C+ blau“ nicht auf „DPZ Profi 1.5L“ fällt; der tokenweise
  Vergleich verhindert, dass „Sprayer K20“ als „Sprayer K2“ gilt.
- Manuell bestätigte Produktzuordnungen werden dauerhaft gespeichert und sofort
  auf alle gleichlautenden Positionen des Durchlaufs angewendet.

**Länder – mitdenkendes Mapping.** Ist das Bestimmungsland nicht eindeutig aus
der Lieferadresse ableitbar, schlägt die App das Land einer nachrangigen
Adresse vor und markiert es als bestätigungspflichtig; ein Klick übernimmt den
Vorschlag. Jede Bestätigung oder Korrektur wird **adressgenau** dauerhaft
gemerkt und hat bei künftigen Läufen Vorrang vor der automatischen Erkennung –
so lernt die App die Abweichungen einzelner Kunden, ohne sie fälschlich auf
ein ganzes Länderkennzeichen zu verallgemeinern. Unbekannte Kennzeichen werden
zusätzlich allgemein gemerkt.

Alle gelernten Zuordnungen liegen im `localStorage` des Browsers und lassen
sich unter „Erweitert“ jederzeit löschen.

## Installation und Entwicklung

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm run dev      # Entwicklungsserver
npm run build    # Produktions-Build nach dist/
npm run preview  # Vorschau des Builds
npm test         # automatisierte Tests
```

### Betrieb ohne Node.js

Der Ordner `dist/` ist eine rein statische Anwendung und benötigt nur einen
beliebigen lokalen Webserver (ein direkter Doppelklick auf `index.html`
funktioniert nicht, da Browser Web Worker von `file://` blockieren):

```bash
python3 -m http.server 8080   # danach http://localhost:8080 öffnen
```

Unter Windows genügt PowerShell mit Bordmitteln – siehe `tools/serve.ps1`.

### Tests

Die Testsuite (Vitest, 83 Tests) prüft unter anderem:

- deutsche Zahlenformate und die Rundungsregeln für Gewicht und EUR,
- Übersetzung der Länderkennzeichen, Adress-Priorität, Vorschlagslogik und das
  Vorrangverhalten gelernter Zuordnungen,
- Produktzuordnung inklusive Präfix-, Schreibweisen- und Abgrenzungsfällen
  sowie Gewicht aus der Produktbeschreibung (Flaschenartikel),
- Positions- und Mengenerkennung über Fettdruck und Spaltenpositionen,
  einschließlich der Abgrenzung zum Preis pro 100,
- Erkennung von `vom:`/`dated:` gegenüber `Ihr Auftrag vom:`/`your order dated:`,
- Netto-Gesamtgewicht aus der Fußzeile (inkl. Abgrenzung zum Netto-Betrag),
- Gewichtssummen-Prüfung mit Toleranz 0 kg,
- Struktur, Zelltypen und Spalte M der exportierten Excel-Datei.

Unter `e2e/` liegt zusätzlich ein optionales End-to-End-Skript, das den
gesamten Ablauf mit synthetischen Testdaten durchspielt und eine echte
`.xlsx`-Datei erzeugt. Es ist nicht Teil der Testsuite und benötigt
zusätzliche Pakete:

```bash
npm install -D playwright pdf-lib
node e2e/generate-sample-invoice.mjs   # erzeugt eine deutsche und eine englische Beispielrechnung
npm run build && npm run preview      # in einem zweiten Terminal
node e2e/run.mjs
```

## Deployment auf GitHub Pages

Der Workflow `.github/workflows/deploy.yml` baut die App bei jedem Push auf
`main` und veröffentlicht sie über GitHub Pages.

1. Repository-Einstellungen → **Pages** → **Source**: „GitHub Actions“.
2. Push auf `main` (oder Workflow manuell starten).
3. Die App ist danach unter
   `https://<benutzername>.github.io/<repository-name>/` erreichbar.

Die Vite-Konfiguration nutzt einen relativen Basis-Pfad (`base: './'`), eine
Anpassung an den Repository-Namen ist nicht nötig.

## Datenschutz

- Alle Verarbeitungsschritte laufen im Browser (JavaScript/WebAssembly).
- Keine Übertragung von Rechnungs-, Gewichts- oder Excel-Daten an externe
  Server, Analyse- oder KI-Dienste.
- Dauerhaft gespeichert werden ausschließlich bestätigte Produkt- und
  Länder-Zuordnungen im `localStorage`. Rechnungsdaten selbst werden nicht
  dauerhaft gespeichert und gehen beim Neuladen der Seite verloren.

## Bekannte Einschränkungen

- Die Erkennung von Position, Menge und Rechnungsnummer setzt **Fettdruck** in
  der PDF voraus. Fehlt diese Information (z. B. bei gescannten Rechnungen über
  OCR), sperrt die App die Rechnung und verlangt eine vollständige manuelle
  Prüfung, statt Werte zu raten.
- Die Betragsspalte wird über die x-Position der Kopfzeile bestimmt. In
  englischen Rechnungen trägt sie laut Vorgabe die Beschriftung `Dly.date`;
  weicht der Aufbau davon ab, kann der Positionsbetrag falsch zugeordnet
  werden. Er ist in der Prüfansicht editierbar, und „Rohtext anzeigen“ zeigt
  den gelesenen PDF-Text zur Diagnose.
- Die Artikelbezeichnung wird aus der Bezeichnungsspalte rechts der
  Positionsnummer zusammengesetzt. Bei stark abweichenden Layouts kann sie
  unvollständig sein; sie ist editierbar, und eine Änderung löst die
  Produktzuordnung sofort neu aus.
- Es wird der `legacy`-Build von pdf.js verwendet. Der Standard-Build von
  pdf.js 6 setzt sehr neue JavaScript-Methoden voraus
  (`Map.prototype.getOrInsertComputed`), die aktuelle Browser noch nicht
  mitbringen – damit schlagen Fettdruck-Erkennung und OCR-Rendering fehl.
- OCR (Tesseract.js) greift nur, wenn eine PDF-Seite keinen ausreichenden
  auslesbaren Text enthält.
- Die Toleranz zwischen berechnetem und ausgewiesenem Netto-Gesamtgewicht ist
  fachlich auf **0 kg** festgelegt. Da jede Position einzeln aufgerundet wird,
  kann Rundungsdrift bei vielen Positionen zu gesperrten Rechnungen führen.
- Die Länderliste umfasst die europäischen Länder in
  `src/lib/countryCodes.ts`. Unbekannte Kennzeichen werden nicht geraten,
  sondern erfragt und anschließend gemerkt.
- Die App wurde mit synthetischen Testdaten entwickelt und geprüft, nicht mit
  echten Kunden- oder Rechnungsdaten.

## Projektstruktur

```
src/
  data/gewichtsliste.ts   fest hinterlegte Gewichtsliste
  assets/Mustertabelle.xlsx  fest hinterlegte Excel-Vorlage
  lib/documentText.ts     Zeilen-/Fettdruck-Modell des PDF-Textes
  lib/                    Kernlogik (Parsing, Berechnungen, Validierung, Export)
  lib/__tests__/          automatisierte Tests
  components/             UI-Komponenten
  App.tsx                 Ablaufsteuerung und Zustandsverwaltung
  types.ts                interne Datentypen (nie im Export sichtbar)
public/standard_fonts     pdf.js-Schriftdaten (für die Fettdruck-Erkennung)
public/cmaps              pdf.js-Zeichentabellen
tools/serve.ps1           lokaler Webserver für Windows ohne Node.js
e2e/                      optionales End-to-End-Skript
.github/workflows/        GitHub Pages Deployment
```
