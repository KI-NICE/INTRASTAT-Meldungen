import data from './artikelGewichtsmapping.json'

/**
 * Fest im Projekt hinterlegte Artikel-Gewichtsmapping (Quelle:
 * "Artikel-Gewichtsmapping.xlsx", Spalte A = Artikel-Nr., Spalte D = Gewicht
 * in Gramm je Stück). Gilt ausschließlich für Ausgangsrechnungen – für
 * Eingangsrechnungen gibt es kein Gewichts-Mapping.
 *
 * Ersetzt die frühere, namensbasierte Gewichtsliste ("Gewichtsliste.docx"):
 * die Zuordnung erfolgt jetzt ausschließlich über die fett gesetzte
 * Artikelnummer je Position, nicht mehr über die Produktbezeichnung.
 */
export const ARTIKEL_GEWICHTSMAPPING: Record<string, number> = data as Record<string, number>

/** Datenstand der hinterlegten Artikel-Gewichtsmapping (TT.MM.JJJJ). */
export const ARTIKEL_GEWICHTSMAPPING_STAND = '21.08.2026'
