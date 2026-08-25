# Intrastat-Meldungs-App

Eine deutschsprachige Web-App zur Erstellung von Intrastat-Meldungen aus
PDF-Rechnungen. **Claude (Anthropic) liest jede Rechnung vollständig aus und
ist die alleinige Quelle der Rechnungsdaten** – es gibt kein lokales,
deterministisches Auslesen und kein Fallback ohne Claude. Alle übrigen
Schritte (Gewichtszuordnung, Berechnungen, Excel-Erstellung) laufen
ausschließlich lokal im Browser.

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
2. **PDF-Rechnungen hochladen** – Mehrfachauswahl oder Drag & Drop.
3. **Analyse starten** – jede Rechnung wird vollständig an Claude übertragen;
   Claude liest Kopf- und Positionsdaten aus. Anschließend laufen
   Produktzuordnung, Berechnungen und Validierung automatisch und lokal.
4. **Prüfen und korrigieren** – je Rechnung eine Karte mit allen von Claude
   gelesenen Kopfdaten und einer Positionstabelle. Jeder Wert ist editierbar;
   manuelle Änderungen werden gelb hervorgehoben. Meldet Claude selbst
   Unsicherheit zu einem Feld, erscheint das als Hinweis.
5. **Vorschau** – zeigt exakt die Daten, die exportiert werden (Spalten A–P).
6. **Export** – nach Prüfung der Zusammenfassung wird `MM-JJJJ.xlsx`
   heruntergeladen. Der Export ist erst möglich, wenn keine ungeklärten Fehler
   mehr vorliegen.

Ist der lokale Claude-Proxy nicht erreichbar (kein API-Key, Proxy nicht
gestartet), zeigt die App von Anfang an nur einen Blockbildschirm – ohne
Claude ist keine Analyse möglich.

## Was Claude ausliest (fachlich vorgegeben)

Claude erhält die vollständige Rechnungs-PDF und liest sie anhand fest
vorgegebener Regeln aus (siehe `SYSTEM_PROMPT` in `server/index.mjs`).
Unsicher gelesene Felder werden von Claude selbst als solche gekennzeichnet
und in der Prüfansicht als Hinweis angezeigt – es wird nichts geraten.

| Feld | Fundstelle in der Rechnung |
| --- | --- |
| Rechnungsnummer | Oben rechts **fett** neben der Überschrift `RECHNUNG` bzw. `INVOICE`. |
| Rechnungsdatum / Bezugsmonat | Feld `vom:` (deutsch) bzw. `dated:` (englisch). Felder mit anderem Bezug – `Ihr Auftrag vom:`, `your order dated:`, `Bestellung vom:`, `Lieferschein vom:` – werden ausdrücklich ignoriert. |
| Position | Linksbündige, **fette** Ganzzahl (`10`, `20`, …). Rechts davon beginnt die Artikelbezeichnung. |
| Menge | Ausschließlich die **fett** gesetzte Zahl (`1000 Stück`, `252 Stück`, englisch `200 pcs`). Preise pro 100 werden nie als Menge gelesen. |
| Positionsbetrag | Wert in der Betragsspalte (`Betrag` deutsch, `Dly.date` englisch). |
| Bestimmungsland (Spalte F) | Länderkennzeichen vor der Postleitzahl der **Lieferadresse**, ersatzweise der **Auftragsadresse**, als ISO-3166-1-Alpha-2-Code (`A`→`AT`, `B`→`BE`, `D`→`DE`, `F`→`FR`, `I`→`IT`, `E`→`ES`, `L`→`LU`, `S`→`SE`, `H`→`HU`, `P`→`PT`, `SLO`→`SI` usw.). Claude gibt zusätzlich die verwendete Adresse als Text zurück, damit Korrekturen adressgenau gespeichert werden können. |
| Netto-Gesamtgewicht | Fußzeile hinter der Sternchen-Trennlinie, beschriftet mit `Net weight:` oder `Netto:`. |
| Warennummer (Spalte J) | Feld `Zolltarif-Nr.:` bzw. `Customs tariff no.:`, als Text gespeichert. |
| USt-IdNr. (Spalte P) | Feld `Ihre USt-IdNr.:` bzw. `Your VAT-ID:`, ohne Leerzeichen. |
| Eigenmasse (Spalte L) | Einzelgewicht (Gewichtsliste bzw. aus der Beschreibung) × Menge, je Position auf volle kg **aufgerundet**. |
| Besondere Maßeinheit (Spalte M) | Nur bei Warennummer `39233010`, Menge als ganze Stückzahl. |
| Rechnungsbetrag (Spalte N) | Positionsbetrag, Frachtkosten anteilig nach Wertanteil aufgeschlagen, auf volle EUR aufgerundet. |
| Statistischer Wert (Spalte O) | Positionswert + anteiliger 4-%-Zuschlag (= 104 %), auf volle EUR aufgerundet. |

Feste Werte: A = `V`, C = `11`, D = `3`, H = `09`, I = `DE`; E, G und K bleiben leer.

Englische Rechnungen werden von Claude automatisch erkannt.

### Frachtkosten-Positionen (Artikelnummer 090025)

Steht in einer Position unter der Spaltenüberschrift „Artikelangaben" bzw.
„Part description" fett die Artikelnummer `090025` über der eigentlichen
Bezeichnung, erkennt Claude dies als reine Frachtkosten-/Transportkosten-Zeile.
Diese Position wird **nicht** als eigene Intrastat-Zeile gemeldet; ihr Betrag
wird wie ausgewiesene Frachtkosten anteilig nach Wertanteil auf die übrigen
Positionen der Rechnung verteilt.

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
  über die fett gesetzte **Artikelnummer** der Position (zuverlässiger, da
  unabhängig von Schreibweise-Varianten) als auch über die Produktbezeichnung.
  Beide Zuordnungen werden sofort auf alle passenden Positionen des aktuellen
  Durchlaufs angewendet und schlagen bei künftigen Läufen automatisch zu –
  die Hilfsliste wächst dadurch mit jeder Korrektur, und es wird zunehmend
  weniger manuelle Prüfung nötig.

**Länder – mitdenkendes Mapping.** Das Bestimmungsland liest Claude direkt aus
der Rechnung. Wird dieser Code manuell korrigiert, wird die Korrektur
**adressgenau** (anhand der von Claude zurückgegebenen Adresse) dauerhaft
gemerkt und hat bei künftigen Läufen Vorrang vor der Lesung durch Claude.

**USt-IdNr. muss zum Bestimmungsland passen.** Weicht das Länderpräfix der
USt-IdNr. des Warenempfängers vom von Claude gelesenen Bestimmungsland ab,
sticht die USt-IdNr. das gelesene Land aus; die Abweichung wird als Hinweis
angezeigt. Eine bereits manuell bestätigte Auswahl wird dadurch nicht
überschrieben.

Alle gelernten Zuordnungen liegen im `localStorage` des Browsers und lassen
sich unter „Erweitert" jederzeit löschen.

## Architektur: Claude als alleinige Quelle

| Aspekt | Festlegung |
|---|---|
| Rolle | Claude liest jede Rechnung vollständig und verbindlich aus. Es gibt **keine** eigene, deterministische PDF-Auswertung mehr, gegen die abgeglichen werden könnte. |
| Übertragene Daten | Die vollständige Rechnungs-PDF. |
| Architektur | Lokaler Proxy (`server/index.mjs`), der den API-Key aus der `.env` liest und die gebaute App ausliefert. Der Key gelangt nie in das Browser-Bundle. |
| Verfügbarkeit | **Zwingend erforderlich.** Ist der Proxy nicht erreichbar oder kein Key hinterlegt, zeigt die App nur einen Blockbildschirm – es gibt kein lokales Fallback. |
| Modellwahl | Über `ANTHROPIC_MODEL` konfigurierbar; ohne Angabe wählt der Proxy das neueste verfügbare Sonnet-Modell des Kontos. |
| Strukturierte Antwort | Erzwungener Werkzeugaufruf mit JSON-Schema, damit die Antwort maschinell weiterverarbeitet werden kann. Claude wird angewiesen, unsichere Felder auf `null` zu setzen und zu benennen, statt zu raten. |
| Bei Lesefehlern | Schlägt das Auslesen einer einzelnen Rechnung fehl (z. B. Netzwerkfehler), bleibt nur diese Rechnung gesperrt; über „Erneut versuchen" lässt sie sich neu einlesen. |

### Einrichtung

Der API-Key darf nicht in die Web-App gelangen – im Browser-Bundle wäre er für
jeden lesbar. Deshalb läuft ein schlanker lokaler Proxy (`server/index.mjs`),
der den Key aus der `.env` liest und zugleich die gebaute App ausliefert.

```bash
cp .env.example .env      # ANTHROPIC_API_KEY eintragen
npm start                 # baut die App und startet den Proxy
# danach http://localhost:8787 öffnen
```

Ohne Key startet der Server ebenfalls, die App bleibt dann aber im
Blockbildschirm. Im Entwicklungsmodus (`npm run dev` auf Port 5173) den Proxy
separat mit `npm run server` starten und `VITE_AI_PROXY_URL=http://localhost:8787`
setzen.

Das Modell wird automatisch bestimmt (neuestes verfügbares Sonnet-Modell des
Kontos) und lässt sich über `ANTHROPIC_MODEL` in der `.env` festlegen.

## Installation und Entwicklung

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm run dev      # Entwicklungsserver (ohne Claude-Anbindung nur der Blockbildschirm)
npm run build    # Produktions-Build nach dist/
npm run preview  # Vorschau des Builds
npm test         # automatisierte Tests
npm run server   # lokaler Proxy (liefert auch dist/ aus)
npm start        # build + Proxy in einem Schritt
```

### Betrieb ohne Node.js

Der Ordner `dist/` ist eine rein statische Anwendung, benötigt aber weiterhin
den lokalen Proxy (`server/index.mjs`), damit Claude erreichbar ist – ein
reiner statischer Webserver reicht nicht mehr aus, da es kein lokales
Fallback gibt.

### Tests

Die Testsuite (Vitest) prüft unter anderem:

- deutsche Zahlenformate und die Rundungsregeln für Gewicht und EUR,
- Ableitung von Bezugsmonat/-jahr aus dem von Claude gelesenen Rechnungsdatum,
- Aufbau der Rechnung aus den von Claude gelesenen Feldern (Warennummer,
  Frachtkosten-Positionen über Artikelnummer 090025, Gutschrift-/Storno-Erkennung),
- Bestimmungsland: gelernte Adress-Zuordnung vs. von Claude gelesener Code,
  Abgleich mit dem Länderpräfix der USt-IdNr.,
- Produktzuordnung inklusive Präfix-, Schreibweisen- und Abgrenzungsfällen
  sowie Gewicht aus der Produktbeschreibung (Flaschenartikel),
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

Da Claude jetzt immer erforderlich ist, braucht der Ablauf einen erreichbaren
Proxy – entweder mit echtem API-Key oder mit der Nachbildung
`e2e/mock-anthropic.mjs`, die ohne echten Key und ohne echte Rechnungsdaten
auskommt:

```bash
node e2e/mock-anthropic.mjs &
ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:8788 npm run server &
APP_URL=http://127.0.0.1:8787/ node e2e/run.mjs
```

## Deployment

Ein GitHub-Pages-Deployment ist bewusst **nicht** eingerichtet: Auf GitHub
Pages läuft kein Proxy und damit keine Claude-Anbindung. Da Claude die
alleinige Quelle der Rechnungsdaten ist, wäre eine dort gehostete App nicht
funktionsfähig – eine Analyse ist ohne den lokalen Proxy nicht möglich. Der
produktive Betrieb erfordert daher immer den lokalen Proxy (`npm start`) bzw.
ein Hosting-Ziel, das Node-Server-Prozesse ausführen kann.

## Datenschutz

- Claude liest **jede** hochgeladene Rechnung vollständig aus – die
  vollständige PDF wird dafür immer an die Anthropic-API übertragen. Es gibt
  keine Möglichkeit, die App ohne diese Übertragung zu nutzen.
- Alle übrigen Verarbeitungsschritte (Produktzuordnung, Berechnungen,
  Excel-Erstellung) laufen im Browser; dabei werden keine zusätzlichen Daten
  an Server übertragen.
- Der Anthropic-API-Key bleibt ausschließlich auf dem lokalen Proxy
  (`server/index.mjs`) und gelangt nie in das Browser-Bundle.
- Dauerhaft gespeichert werden ausschließlich bestätigte Produkt- und
  Länder-Zuordnungen im `localStorage`. Rechnungsdaten selbst werden nicht
  dauerhaft gespeichert und gehen beim Neuladen der Seite verloren.

## Bekannte Einschränkungen

- Claude ist die alleinige Quelle der Rechnungsdaten. Ohne erreichbaren Proxy
  mit gültigem API-Key ist die App nicht funktionsfähig – es gibt kein
  lokales Fallback.
- Die Erkennungsgenauigkeit hängt von Claudes Lesefähigkeit ab. Jeder Wert ist
  in der Prüfansicht editierbar; meldet Claude selbst Unsicherheit zu einem
  Feld, erscheint das als Hinweis.
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
  data/gewichtsliste.ts      fest hinterlegte Gewichtsliste
  assets/Mustertabelle.xlsx  fest hinterlegte Excel-Vorlage
  lib/aiVerification.ts      Anbindung an den lokalen Claude-Proxy
  lib/aiInvoiceBuilder.ts    baut das Rechnungsmodell aus den von Claude gelesenen Feldern
  lib/                       Kernlogik (Produktzuordnung, Berechnungen, Validierung, Export)
  lib/__tests__/             automatisierte Tests
  components/                UI-Komponenten
  App.tsx                    Ablaufsteuerung und Zustandsverwaltung
  types.ts                   interne Datentypen (nie im Export sichtbar)
server/index.mjs             lokaler Proxy zu Claude (Key bleibt serverseitig)
tools/serve.ps1              lokaler Webserver für Windows ohne Node.js
e2e/                         optionales End-to-End-Skript inkl. API-Nachbildung
.env.example                 Vorlage für den API-Key (die .env wird nicht eingecheckt)
```
