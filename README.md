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

| Feld | Fundstelle in der Rechnung |
| --- | --- |
| Rechnungsdatum / Bezugsmonat | Feld `vom:` direkt unter der Rechnungsnummer. Felder wie `Ihr Auftrag vom:`, `Bestellung vom:` oder `Lieferschein vom:` werden ausdrücklich ignoriert. |
| Bestimmungsland (Spalte F) | Länderkennzeichen vor der Postleitzahl der **Lieferadresse**, ersatzweise der **Auftragsadresse**. `A` → `AT`, `B` → `BE`, `D` → `DE`, `SLO` → `SI` usw. |
| Menge | Je Position im Format `#.###,## Stück`. |
| Netto-Gesamtgewicht | Fußzeile hinter der Sternchen-Trennlinie, beschriftet mit `Net weight:` oder `Netto:`. Ein Netto-*Betrag* in EUR wird nicht damit verwechselt. |
| Warennummer (Spalte J) | Feld `Zolltarif-Nr.:` bzw. `Zolltarif-Nr..:` der Position, als Text gespeichert. |
| USt-IdNr. (Spalte P) | Feld `Ihre USt-IdNr.:`, Leerzeichen werden entfernt. |
| Eigenmasse (Spalte L) | Einzelgewicht aus der Gewichtsliste × Menge, je Position auf volle kg **aufgerundet**. |
| Besondere Maßeinheit (Spalte M) | Nur bei Warennummer `39233010`, Menge als ganze Stückzahl. |
| Rechnungsbetrag (Spalte N) | Positionsbetrag, Frachtkosten anteilig nach Wertanteil aufgeschlagen, auf volle EUR aufgerundet. |
| Statistischer Wert (Spalte O) | Positionswert + anteiliger 4-%-Zuschlag (= 104 %), auf volle EUR aufgerundet. |

Feste Werte: A = `V`, C = `11`, D = `3`, H = `09`, I = `DE`; E, G und K bleiben leer.

## Zuordnungen und Lernverhalten

- **Produkte**: exakter Treffer → normalisierter Treffer → zuvor manuell
  bestätigte Zuordnung → eindeutiger Treffer über den Bezeichnungsanfang
  (z. B. „Sprayer K2 rot mit Kappe“ → „Sprayer K2“, 50 g; der längste passende
  Eintrag gewinnt, damit „DPZ Profi 1.5L C+ blau“ nicht auf „DPZ Profi 1.5L“
  fällt). Bleibt es unklar, verlangt die App eine Auswahl und übernimmt nichts
  automatisch.
- **Länder**: lässt sich das Kennzeichen nicht auflösen, fragt die App nach.
  Die bestätigte Zuordnung wird dauerhaft gespeichert und in derselben Sitzung
  sofort auf weitere Rechnungen mit demselben Kennzeichen angewendet.
- Bestätigte Produkt- und Länder-Zuordnungen liegen im `localStorage` des
  Browsers und lassen sich unter „Erweitert“ jederzeit löschen.

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

Die Testsuite (Vitest, 68 Tests) prüft unter anderem:

- deutsche Zahlenformate und die Rundungsregeln für Gewicht und EUR,
- Übersetzung der Länderkennzeichen und die Adress-Priorität,
- Produktzuordnung inklusive Präfix- und Abgrenzungsfällen,
- Erkennung von `vom:` gegenüber `Ihr Auftrag vom:`,
- Netto-Gesamtgewicht aus der Fußzeile (inkl. Abgrenzung zum Netto-Betrag),
- Gewichtssummen-Prüfung mit Toleranz 0 kg,
- Struktur, Zelltypen und Spalte M der exportierten Excel-Datei.

Unter `e2e/` liegt zusätzlich ein optionales End-to-End-Skript, das den
gesamten Ablauf mit synthetischen Testdaten durchspielt und eine echte
`.xlsx`-Datei erzeugt. Es ist nicht Teil der Testsuite und benötigt
zusätzliche Pakete:

```bash
npm install -D playwright pdf-lib
node e2e/generate-sample-invoice.mjs
npm run build && npm run preview   # in einem zweiten Terminal
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

- Die Positions-Erkennung ist an einem Vorkommen von `Zolltarif-Nr.:`
  verankert. **Produktbezeichnung und Positionsbetrag** werden innerhalb des
  Positionsblocks heuristisch bestimmt (Bezeichnung: Text bei bzw. nach der
  Mengenangabe; Betrag: letzter Geldbetrag im Block, da der Positionsbetrag in
  tabellarischen Rechnungen rechts steht). Bei abweichenden Layouts können
  diese beiden Felder falsch zugeordnet werden – sie sind deshalb in der
  Prüfansicht editierbar, und „Rohtext anzeigen“ hilft bei der Diagnose.
- OCR (Tesseract.js) greift nur, wenn eine PDF-Seite keinen ausreichenden
  auslesbaren Text enthält. OCR-Ergebnisse sind unsicherer; betroffene
  Rechnungen werden gekennzeichnet und sollten besonders sorgfältig geprüft
  werden.
- Die Toleranz zwischen berechnetem und ausgewiesenem Netto-Gesamtgewicht ist
  fachlich auf **0 kg** festgelegt. Da jede Position einzeln aufgerundet wird,
  kann Rundungsdrift bei vielen Positionen zu gesperrten Rechnungen führen.
- Die Länderliste umfasst die europäischen Länder in
  `src/lib/countryCodes.ts`. Unbekannte Kennzeichen werden nicht geraten,
  sondern erfragt und anschließend gespeichert.
- Die App wurde mit synthetischen Testdaten entwickelt und geprüft, nicht mit
  echten Kunden- oder Rechnungsdaten.

## Projektstruktur

```
src/
  data/gewichtsliste.ts   fest hinterlegte Gewichtsliste
  assets/Mustertabelle.xlsx  fest hinterlegte Excel-Vorlage
  lib/                    Kernlogik (Parsing, Berechnungen, Validierung, Export)
  lib/__tests__/          automatisierte Tests
  components/             UI-Komponenten
  App.tsx                 Ablaufsteuerung und Zustandsverwaltung
  types.ts                interne Datentypen (nie im Export sichtbar)
tools/serve.ps1           lokaler Webserver für Windows ohne Node.js
e2e/                      optionales End-to-End-Skript
.github/workflows/        GitHub Pages Deployment
```
