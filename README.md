# Intrastat-Meldungs-App

Eine deutschsprachige Web-App zur Erstellung von Intrastat-Meldungen aus
Excel-Rechnungsdaten. **Die App ist eine rein statische Single-Page-App** –
es gibt keinen Server, keinen API-Key und keine externe Anbindung. Alle
Verarbeitungsschritte (Einlesen, Gewichtszuordnung, Berechnungen,
Excel-Erstellung) laufen ausschließlich lokal im Browser.

## Fest hinterlegte Grunddaten

Gewichtsliste und Mustertabelle sind Teil der Anwendung und müssen **nicht**
hochgeladen werden:

| Datei | Ort im Projekt | Verwendung |
| --- | --- | --- |
| Gewichtsliste (23 Produkte, Gewicht je Stück in Gramm) | `src/data/gewichtsliste.ts` | Produkt- und Gewichtszuordnung |
| Mustertabelle.xlsx | `src/assets/Mustertabelle.xlsx` | Struktur und Formatierung des Exports |

Ändert sich die Gewichtsliste dauerhaft, wird `src/data/gewichtsliste.ts`
angepasst und die App neu gebaut. Für einen einmaligen Test lässt sich die
Liste unter „Erweitert" vorübergehend durch eine DOCX-Datei ersetzen; diese
Ersetzung gilt nur bis zum Neuladen der Seite.

## Bedienung

1. **Bezugsmonat auswählen** – Monat und Jahr. In Spalte B wird nur die
   zweistellige Monatszahl ausgegeben; das Jahr dient der Plausibilitätsprüfung
   und dem Dateinamen.
2. **Rechnungen hochladen** – eine Excel-Datei (`.xlsx`, Format siehe unten)
   mit einer Zeile je Rechnungsposition. Die Datei wird sofort lokal
   eingelesen; jede enthaltene Rechnungsnummer erscheint einzeln in der
   Liste. Optional lässt sich zusätzlich die "Zusammenfassende Meldung" (ebenfalls
   als Excel) hochladen – ein Abgleich warnt dann vor fehlenden oder
   zusätzlichen Rechnungen, lässt sich aber jederzeit übergehen.
3. **Prüfen und korrigieren** – je Rechnung eine Karte mit allen eingelesenen
   Kopfdaten und einer Positionstabelle. Jeder Wert ist editierbar; manuelle
   Änderungen werden gelb hervorgehoben.
4. **Vorschau** – zeigt exakt die Daten, die exportiert werden (Spalten A–P).
5. **Export** – nach Prüfung der Zusammenfassung wird `MM-JJJJ.xlsx`
   heruntergeladen. Der Export ist erst möglich, wenn keine ungeklärten Fehler
   mehr vorliegen.

Alternativ lassen sich Rechnungen auch **rein manuell** erfassen (Button
„Nur manuelle Eingabe" bzw. „Weitere Rechnung manuell hinzufügen" in der
Prüfansicht), ganz ohne Excel-Import.

## Format der Rechnungs-Excel-Datei

Eine Zeile je Rechnungsposition, mehrere Zeilen je Rechnungsnummer. Die erste
Zeile gilt als Kopfzeile und wird übersprungen.

| Spalte | Kürzel | Bedeutung |
| --- | --- | --- |
| A | RENR | Rechnungsnummer |
| B | RGDA | Rechnungsdatum, Format `JJJJMMTT` |
| C | IDLD | Länderkennung der USt-IdNr./Bestimmungsland (`AT`, `NL`, `FR` …; `99` = Drittland, ohne Lieferadresse in der Datei nicht auflösbar – muss dann manuell gewählt werden) |
| D | IDNR | USt-IdNr. des Kunden ohne Länderpräfix (bei Drittland leer) |
| E | AFHP | Positionsnummer innerhalb der Rechnung (`10`, `20`, `30`, …) |
| F | TENR | Teile-/Artikelnummer |
| G/H | BEZG | Artikelbezeichnung (zwei Zeilen) |
| I | MENG | Menge in Stück |
| J | – | Positionswert in EUR |
| K | GWNE | Nettogewicht je Stück – wird **ignoriert**, da die App eine eigene Gewichtsliste führt |
| L | KDNR | Kundennummer |
| M/N | NAME | Kundenname (zwei Zeilen) |
| O | STRA | Straße |
| P | WORT | Ort |
| Q | ZOTA | Zolltarifnummer (8-stellig) |

**Sonderpositionen** (Artikelnummer beginnt mit `09`, keine eigene
Intrastat-Zeile):

- Frachtkosten/Sonderkosten (z. B. `090024`, `090025`) werden anteilig nach
  Wertanteil auf die übrigen Positionen der Rechnung umgelegt.
- Materialteuerungszuschläge (Artikelnummern `090038`–`090042`, `090044`,
  `090045`) werden **immer der unmittelbar vorangehenden Position**
  zugerechnet.

Fehlt das Gesamt-Nettogewicht oder eine Zolltarifnummer, bleibt das Feld in
der Prüfansicht leer und ist dort manuell nachzutragen – wie bei manuell
erfassten Rechnungen auch.

## Zuordnungen und Lernverhalten

**Produkte.** Gewicht aus der Produktbeschreibung → gelernte Zuordnung über
die Artikelnummer → gelernte Zuordnung über die Produktbezeichnung → exakter
Treffer → normalisierter Treffer → eindeutiger Treffer über den
Bezeichnungsanfang. Bleibt es unklar, verlangt die App eine Auswahl und
übernimmt nichts automatisch.

- **Flaschenartikel** (`Zyl.`, `Zylinderflasche`, `Zylk.`, `FL`, `VK`,
  `Vierkant`) tragen das Artikelgewicht in der Beschreibung selbst, z. B.
  `Gew.:20 g`. Dieses Gewicht wird direkt verwendet und **nicht** über die
  Gewichtsliste ermittelt.
- **Fortfolgende Bezeichnungen** werden über einen tokenweisen Abgleich des
  Bezeichnungsanfangs aufgelöst: „DPZ Hobby 1,0 L natur mit Deckel" →
  „DPZ Hobby 1.0L" (330 g). Ausgeschriebenes „Druckpumpzerstäuber" wird dabei
  wie „DPZ" behandelt. Der längste passende Eintrag gewinnt.
- **Manuelle Gewichtseingabe.** Findet sich kein Treffer – oder ist der Wert
  in der hinterlegten Gewichtsliste veraltet bzw. abweichend –, lässt sich in
  der Prüfansicht ein Gewicht je Stück direkt eintragen, statt nur aus der
  Gewichtsliste zu wählen. Diese Korrektur wird dauerhaft gespeichert: sowohl
  über die Artikelnummer der Position (zuverlässiger, da unabhängig von
  Schreibweise-Varianten) als auch über die Produktbezeichnung. Beide
  Zuordnungen werden sofort auf alle passenden Positionen des aktuellen
  Durchlaufs angewendet und schlagen bei künftigen Läufen automatisch zu –
  die Hilfsliste wächst dadurch mit jeder Korrektur, und es wird zunehmend
  weniger manuelle Prüfung nötig.

**Länder – mitdenkendes Mapping.** Wird ein Bestimmungsland manuell
korrigiert, wird die Korrektur **adressgenau** (anhand der eingelesenen
Kundenadresse) dauerhaft gemerkt und hat bei künftigen Läufen Vorrang vor der
Spalte IDLD.

**USt-IdNr. muss zum Bestimmungsland passen.** Weicht das Länderpräfix der
USt-IdNr. des Warenempfängers vom eingelesenen Bestimmungsland ab, sticht die
USt-IdNr. das gelesene Land aus; die Abweichung wird als Hinweis angezeigt.
Eine bereits manuell bestätigte Auswahl wird dadurch nicht überschrieben.

Alle gelernten Zuordnungen liegen im `localStorage` des Browsers und lassen
sich unter „Erweitert" jederzeit löschen.

## Installation und Entwicklung

Voraussetzung: Node.js ≥ 22 (wegen jsdom 30 in den Tests).

```bash
npm install
npm run dev      # Entwicklungsserver (http://localhost:5173)
npm run build    # Produktions-Build nach dist/
npm run preview  # Vorschau des Builds
npm test         # automatisierte Tests
npm start        # build + preview in einem Schritt
```

### Betrieb ohne Node.js

Der Ordner `dist/` ist eine rein statische Anwendung und lässt sich mit
jedem beliebigen Webserver ausliefern – auch ohne Node.js, z. B. mit dem
mitgelieferten `tools/serve.ps1` (nur PowerShell, siehe Kommentar im Skript).

## Deployment auf GitHub Pages

Die App lässt sich als rein statische Seite über GitHub Pages hosten – der
Workflow `.github/workflows/deploy.yml` baut die App bei jedem Push auf
`master` und veröffentlicht sie automatisch. Einmalig muss in den
Repository-Einstellungen unter „Pages" die Quelle auf „GitHub Actions"
gestellt werden.

## Datenschutz

- Es findet **keine Übertragung von Rechnungsdaten an Dritte** statt. Alle
  Verarbeitungsschritte (Einlesen der Excel-Datei, Produktzuordnung,
  Berechnungen, Excel-Erstellung) laufen ausschließlich im Browser.
- Dauerhaft gespeichert werden ausschließlich bestätigte Produkt- und
  Länder-Zuordnungen im `localStorage`. Rechnungsdaten selbst werden nicht
  dauerhaft gespeichert und gehen beim Neuladen der Seite verloren.

## Bekannte Einschränkungen

- Das genaue Spaltenformat der "Zusammenfassenden Meldung" als Excel-Datei
  ist noch nicht an einer echten Beispieldatei verifiziert (anders als das
  Rechnungsformat) – die Spalten "Beleg-Nr." und "Text" werden anhand der
  Kopfzeile gesucht, was robuster ist als feste Spaltenpositionen, aber bei
  einer abweichenden Struktur zu einer Fehlermeldung führen kann.
- Die Toleranz zwischen berechnetem und ausgewiesenem Netto-Gesamtgewicht ist
  fachlich auf **0 kg** festgelegt. Da jede Position einzeln aufgerundet wird,
  kann Rundungsdrift bei vielen Positionen zu gesperrten Rechnungen führen.
- Die Länderliste umfasst die europäischen Länder in
  `src/lib/countryCodes.ts`. Unbekannte Kennzeichen werden nicht geraten,
  sondern erfragt und anschließend gemerkt.

## Projektstruktur

```
src/
  data/gewichtsliste.ts      fest hinterlegte Gewichtsliste
  assets/Mustertabelle.xlsx  fest hinterlegte Excel-Vorlage
  lib/excelImport.ts         Excel-Import (Rechnungen + Zusammenfassende Meldung)
  lib/aiInvoiceBuilder.ts    Hilfsfunktionen für manuell erfasste Rechnungen
  lib/                       Kernlogik (Produktzuordnung, Berechnungen, Validierung, Export)
  lib/__tests__/             automatisierte Tests
  components/                UI-Komponenten
  App.tsx                    Ablaufsteuerung und Zustandsverwaltung
  types.ts                   interne Datentypen (nie im Export sichtbar)
tools/serve.ps1              lokaler Webserver für Windows ohne Node.js
.github/workflows/deploy.yml GitHub-Pages-Deployment
```
