# Intrastat-Meldungs-App

Eine deutschsprachige Web-App zur Erstellung von Intrastat-Meldungen aus
PDF-Rechnungen. Die gesamte Verarbeitung – PDF-Auslesen, OCR-Fallback,
Gewichtsliste, Excel-Erstellung – läuft ausschließlich lokal im Browser. Es
werden keine Rechnungs-, Gewichts- oder Excel-Daten an einen Server
übertragen.

Das zugehörige technische Konzept (Datenmodell, Verarbeitungsschritte,
Prüfregeln, Bibliotheken) liegt im Projekt unter
`claude/Technisches-Konzept.md`.

## Installation

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm run dev
```

Die App ist danach unter der von Vite ausgegebenen lokalen Adresse erreichbar.

### Produktions-Build

```bash
npm run build
npm run preview   # Vorschau des Builds
```

### Tests

```bash
npm test
```

Die automatisierten Tests (Vitest) prüfen unter anderem: deutsche
Zahlenformate, Rundungsregeln (Gewicht/EUR), Ländercode-Auflösung,
Produktzuordnung (exakt/normalisiert/manuell), Gewichtssummen-Validierung
sowie die Struktur/Zelltypen der exportierten Excel-Datei.

Zusätzlich liegt unter `e2e/` ein optionales End-to-End-Skript
(Playwright), das den gesamten 8-Schritte-Ablauf mit Beispieldaten
durchspielt und eine echte `.xlsx`-Datei erzeugt. Es ist nicht Teil der
regulären Testsuite und benötigt zusätzliche, nicht mitinstallierte
Pakete (`npm install -D playwright pdf-lib`).

## Bedienung

1. **Mustertabelle hochladen** – die bereitgestellte `Mustertabelle.xlsx`.
2. **Gewichtsliste hochladen** – die Word-Datei mit Produkt/Gewicht-Angaben
   (Gewicht je Stück, in Gramm).
3. **Bezugsmonat auswählen** – Monat und Jahr, zu dem alle hochgeladenen
   Rechnungen gehören müssen.
4. **PDF-Rechnungen hochladen** – Mehrfachauswahl oder Drag & Drop.
5. **Analyse starten** – Text-/OCR-Extraktion, Feld- und Positionserkennung,
   Produktzuordnung, Berechnungen und Validierung laufen automatisch.
6. **Fehler und offene Zuordnungen bearbeiten** – die Prüfansicht zeigt jede
   Rechnungsposition mit allen relevanten Feldern. Automatisch erkannte
   Werte sind editierbar; manuelle Änderungen werden gelb hervorgehoben.
   Unsichere Produktzuordnungen, unklare Bestimmungsländer und vermutete
   Gutschriften/Stornos/Rabatte müssen hier bestätigt oder korrigiert
   werden.
7. **Vorschau** – zeigt exakt die Daten, die in die Excel-Datei exportiert
   werden (Spalten A–P).
8. **Export** – nach Prüfung der Zusammenfassung (Anzahl Rechnungen,
   Zeilen, Gesamtbetrag, Gesamtmasse, statistischer Wert, Anzahl manueller
   Korrekturen) wird `MM-JJJJ.xlsx` heruntergeladen. Der Export ist erst
   möglich, wenn keine ungeklärten Fehler mehr vorliegen.

Bestätigte Produktzuordnungen werden dauerhaft im Browser (`localStorage`)
gespeichert und beim nächsten Durchlauf automatisch vorgeschlagen. Sie
können durch Löschen der Browserdaten für diese Seite entfernt werden.

## Deployment auf GitHub Pages

Der Workflow `.github/workflows/deploy.yml` baut die App bei jedem Push auf
`main` und veröffentlicht sie über GitHub Pages.

Einmalige Einrichtung im Repository:

1. Repository-Einstellungen → **Pages** → **Source**: „GitHub Actions“
   auswählen.
2. Push auf `main` (oder den Workflow manuell über „Run workflow“ starten).
3. Nach erfolgreichem Lauf ist die App unter
   `https://<benutzername>.github.io/<repository-name>/` erreichbar.

Die Vite-Konfiguration verwendet einen relativen Basis-Pfad (`base: './'`),
sodass keine Anpassung an den Repository-Namen nötig ist.

## Datenschutz

- Alle Verarbeitungsschritte (PDF-Text-Extraktion, OCR, DOCX-Parsing,
  Excel-Erstellung) laufen im Browser (JavaScript/WebAssembly).
- Es findet keine Übertragung von Rechnungs-, Gewichts- oder Excel-Daten an
  externe Server, Analyse- oder KI-Dienste statt.
- Der einzige dauerhaft gespeicherte Zustand sind bestätigte
  Produkt-Zuordnungen (Produktname → Gewicht) im `localStorage` des
  Browsers. Rechnungsdaten selbst werden nicht dauerhaft gespeichert und
  gehen beim Schließen/Neuladen der Seite verloren.

## Bekannte Einschränkungen

- Die Feld-Erkennung (Rechnungsnummer, Datum, Adressen, Positionen usw.)
  basiert auf Textmustern/Bezeichnungen, wie sie in der Aufgabenstellung
  beschrieben sind (z. B. „Vom:“, „Zolltarif-Nr.:“, „Ihre USt-IdNr.:“).
  Abweichende Rechnungslayouts können eine Anpassung der Erkennungsmuster
  in `src/lib/invoiceParser.ts` erfordern.
- OCR (Tesseract.js) wird nur eingesetzt, wenn eine PDF-Seite keinen
  ausreichenden auslesbaren Text enthält. OCR-Ergebnisse sind grundsätzlich
  unsicherer als eingebetteter Text; betroffene Rechnungen sollten in der
  Prüfansicht besonders sorgfältig kontrolliert werden.
- Bei einer Toleranz von 0 kg zwischen berechnetem und auf der Rechnung
  ausgewiesenem Netto-Gesamtgewicht führt rundungsbedingte Drift (jede
  Position wird einzeln aufgerundet) häufiger zu gesperrten Rechnungen –
  das ist laut Vorgabe so gewollt, sollte den Nutzenden aber bewusst sein.
- Die Adress-/Länder-Erkennung basiert auf einer festen Liste europäischer
  Länder (`src/lib/countryCodes.ts`); Länder außerhalb dieser Liste müssen
  manuell zugeordnet werden.
- Die App wurde ohne reale Kunden-/Rechnungsdaten entwickelt und getestet
  (synthetische Testdaten). Bei realen Rechnungen aus der Praxis kann eine
  Nachjustierung der Erkennungsmuster notwendig sein.

## Projektstruktur

```
src/
  lib/                 Kernlogik (Parsing, Berechnungen, Validierung, Excel)
  lib/__tests__/       Automatisierte Tests (Vitest)
  components/          UI-Komponenten des 8-Schritte-Ablaufs
  App.tsx              Zustandsverwaltung und Ablaufsteuerung
  types.ts             Zentrale Datentypen (nur intern, nicht im Export)
e2e/                    Optionales manuelles End-to-End-Testskript
.github/workflows/      GitHub Pages Deployment
```
