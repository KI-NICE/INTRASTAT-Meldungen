// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { matchProductWeight, extractWeightFromDescription } from '../productMatcher'

const WEIGHT_MAP: Record<string, number> = {
  '002000': 50,
  '002001': 330,
}

describe('extractWeightFromDescription', () => {
  it('liest das Artikelgewicht aus der Produktbeschreibung', () => {
    const result = extractWeightFromDescription('Zyl.Flasche 250 ml natur Gew.:20 g')
    expect(result?.grams).toBe(20)
    expect(result?.isBottleArticle).toBe(true)
  })

  it('erkennt die Flaschen-Kennzeichen Zyl., Zylinderflasche, FL, Zylk., VK, Vierkant', () => {
    for (const label of ['Zyl. 500ml', 'Zylinderflasche 1L', 'FL 250ml', 'Zylk. 300ml', 'VK 200ml', 'Vierkant 400ml']) {
      const result = extractWeightFromDescription(`${label} Gew.: 18 g`)
      expect(result?.isBottleArticle, label).toBe(true)
      expect(result?.grams, label).toBe(18)
    }
  })

  it('versteht Varianten der Schreibweise und rechnet kg um', () => {
    expect(extractWeightFromDescription('Artikel Gewicht: 12,5 g')?.grams).toBeCloseTo(12.5)
    expect(extractWeightFromDescription('Artikel Gew: 1,2 kg')?.grams).toBeCloseTo(1200)
    expect(extractWeightFromDescription('Bottle Weight: 30 g')?.grams).toBe(30)
  })

  it('liefert null, wenn kein Gewicht angegeben ist', () => {
    expect(extractWeightFromDescription('Sprayer K2 rot mit Kappe')).toBeNull()
    expect(extractWeightFromDescription('Zyl.Flasche 250 ml')).toBeNull()
  })
})

describe('matchProductWeight', () => {
  it('nutzt bei Flaschenartikeln das Gewicht aus der Beschreibung statt dem Artikel-Gewichtsmapping', () => {
    const result = matchProductWeight('Zyl.Flasche 250 ml natur Gew.:20 g', '002000', WEIGHT_MAP)
    expect(result.matchType).toBe('beschreibung')
    expect(result.entry?.unitWeightGrams).toBe(20)
  })

  it('findet einen Treffer im Artikel-Gewichtsmapping über die Artikelnummer', () => {
    const result = matchProductWeight('Sprayer K2', '002000', WEIGHT_MAP)
    expect(result.matchType).toBe('exact')
    expect(result.entry?.unitWeightGrams).toBe(50)
    expect(result.entry?.name).toBe('002000')
  })

  it('liefert keinen Treffer ohne Artikelnummer', () => {
    const result = matchProductWeight('Sprayer K2', undefined, WEIGHT_MAP)
    expect(result.matchType).toBe('none')
    expect(result.entry).toBeNull()
  })

  it('liefert keinen Treffer, wenn die Artikelnummer nicht im Mapping enthalten ist', () => {
    const result = matchProductWeight('Unbekannt', '999999', WEIGHT_MAP)
    expect(result.matchType).toBe('none')
    expect(result.entry).toBeNull()
  })

  it('findet eine manuell in die Gewichtsliste geschriebene Korrektur wie jeden anderen Eintrag (kein separater Speicher)', () => {
    // Eine Korrektur landet direkt in der Gewichtsliste (siehe
    // App.handleConfirmProductMapping) statt in einem eigenen, davon
    // unabhängigen Speicher – dadurch wirkt sich ein Zurücksetzen der Liste
    // immer sofort korrekt aus.
    const correctedMap = { ...WEIGHT_MAP, '002000': 62 }
    const result = matchProductWeight('Sprayer K2', '002000', correctedMap)
    expect(result.matchType).toBe('exact')
    expect(result.entry?.unitWeightGrams).toBe(62)
  })

  it('ignoriert eine leere Artikelnummer', () => {
    const result = matchProductWeight('Sprayer K2', '   ', WEIGHT_MAP)
    expect(result.matchType).toBe('none')
  })
})
