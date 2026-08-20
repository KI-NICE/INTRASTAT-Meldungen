import type { ProductWeightEntry } from '../types'

/**
 * Fest im Projekt hinterlegte Gewichtsliste (Quelle: "Gewichtsliste.docx").
 * Die Gewichte gelten je Stück und sind in Gramm angegeben.
 *
 * Diese Liste ist bewusst als Code-Datei hinterlegt, damit sie ohne Upload
 * dauerhaft mit der App verknüpft ist. Bei Änderungen an der Gewichtsliste
 * genügt es, diese Datei anzupassen (oder in der App die optionale Funktion
 * "Gewichtsliste aktualisieren" zu verwenden – diese gilt dann für die
 * laufende Sitzung).
 */
export const GEWICHTSLISTE: ProductWeightEntry[] = [
  { name: 'DPZ Hobby 1.0L', unitWeightGrams: 330 },
  { name: 'DPZ Hobby Plus 1.2L', unitWeightGrams: 410 },
  { name: 'DPZ Profi 1.5L', unitWeightGrams: 450 },
  { name: 'DPZ Profi 1.5L C+', unitWeightGrams: 475 },
  { name: 'DPZ Vario 1.8L', unitWeightGrams: 485 },
  { name: 'DPZ Vario 1.8L C+', unitWeightGrams: 500 },
  { name: 'DPZ Oberteil', unitWeightGrams: 180 },
  { name: 'Xtenso 15 cm', unitWeightGrams: 26 },
  { name: 'Xtenso 30 cm', unitWeightGrams: 35 },
  { name: 'Xtenso 50 cm', unitWeightGrams: 45 },
  { name: 'Dichtungssatz', unitWeightGrams: 10 },
  { name: 'Fingerdruckzerstäuber MVII', unitWeightGrams: 9, zusatz: 'inkl. Kappe' },
  { name: 'Fingerdruckzerstäuber SI', unitWeightGrams: 13, zusatz: 'inkl. Kappe' },
  { name: 'Mini Trigger', unitWeightGrams: 16 },
  { name: 'Sicherheitsverschluss', unitWeightGrams: 7 },
  { name: 'Schraubverschluss', unitWeightGrams: 4 },
  { name: 'Spritzverschluss', unitWeightGrams: 5 },
  { name: 'Tropfverschluss', unitWeightGrams: 5 },
  { name: 'Sprayer K2', unitWeightGrams: 50 },
  { name: 'Sprayer K3', unitWeightGrams: 35 },
  { name: 'Sprayer K4', unitWeightGrams: 40 },
  { name: 'Coding Cap einzeln', unitWeightGrams: 4 },
  { name: 'Coding Cap Set', unitWeightGrams: 25 },
]
