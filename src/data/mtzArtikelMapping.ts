import data from './mtzArtikelMapping.json'

/**
 * Fest im Projekt hinterlegtes Materialteuerungszuschlag-Mapping (Quelle:
 * "MTZ-Artikel.xlsx", Spalte A = Artikelnummer, Spalte D = zugehöriger
 * Materialteuerungszuschlag-Artikel). Nur Artikel mit einem tatsächlich
 * hinterlegten Zuschlagsartikel sind enthalten (Zeilen mit "-" wurden
 * ausgelassen).
 *
 * Materialteuerungszuschläge werden auf unseren Ausgangsrechnungen als
 * eigene Position direkt unter der zugehörigen Artikelposition ausgewiesen
 * ("Artikelposition, MTZ-Position, Artikelposition, MTZ-Position, …").
 * Diese Zuordnung wird genutzt, um eine solche Folgeposition dem richtigen
 * Artikel zuzurechnen (siehe `aiInvoiceBuilder.ts`).
 */
export const MTZ_ARTIKEL_MAPPING: Record<string, string> = data as Record<string, string>
