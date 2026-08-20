// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { matchProduct, extractWeightFromDescription, normalizeForMatch } from '../productMatcher'
import { clearManualMappings, saveManualMapping } from '../mappingStore'
import { GEWICHTSLISTE } from '../../data/gewichtsliste'

const WEIGHT_LIST = GEWICHTSLISTE

beforeEach(() => {
  clearManualMappings()
})

describe('normalizeForMatch', () => {
  it('vereinheitlicht Dezimalzeichen und zieht Zahl und Einheit zusammen', () => {
    expect(normalizeForMatch('DPZ Hobby 1,0 L')).toBe('dpz hobby 1.0l')
    expect(normalizeForMatch('DPZ Hobby 1.0L')).toBe('dpz hobby 1.0l')
    expect(normalizeForMatch('Xtenso 15 cm')).toBe('xtenso 15cm')
  })
})

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

describe('matchProduct', () => {
  it('nutzt bei Flaschenartikeln das Gewicht aus der Beschreibung statt der Gewichtsliste', () => {
    const result = matchProduct('Zyl.Flasche 250 ml natur Gew.:20 g', WEIGHT_LIST)
    expect(result.matchType).toBe('beschreibung')
    expect(result.entry?.unitWeightGrams).toBe(20)
  })

  it('findet exakte und normalisierte Treffer', () => {
    expect(matchProduct('Sprayer K2', WEIGHT_LIST).matchType).toBe('exact')
    expect(matchProduct('  sprayer   k2 ', WEIGHT_LIST).matchType).toBe('normalized')
  })

  it('ordnet "Sprayer K2 ..." dem Eintrag "Sprayer K2" zu (50 g)', () => {
    const result = matchProduct('Sprayer K2 rot mit Kappe 28/410', WEIGHT_LIST)
    expect(result.matchType).toBe('prefix')
    expect(result.entry?.name).toBe('Sprayer K2')
    expect(result.entry?.unitWeightGrams).toBe(50)
  })

  it('erkennt fortfolgende Bezeichnungen von "DPZ Hobby" trotz anderer Schreibweise', () => {
    const result = matchProduct('DPZ Hobby 1,0 L natur mit Deckel', WEIGHT_LIST)
    expect(result.entry?.name).toBe('DPZ Hobby 1.0L')
    expect(result.entry?.unitWeightGrams).toBe(330)
  })

  it('bevorzugt bei Präfix-Treffern den längsten passenden Eintrag', () => {
    const result = matchProduct('DPZ Profi 1,5 L C+ blau transparent', WEIGHT_LIST)
    expect(result.entry?.name).toBe('DPZ Profi 1.5L C+')
    expect(result.entry?.unitWeightGrams).toBe(475)
  })

  it('verwechselt "Sprayer K2" nicht mit "Sprayer K20"', () => {
    const result = matchProduct('Sprayer K20 spezial', WEIGHT_LIST)
    expect(result.matchType).not.toBe('prefix')
    expect(result.entry).toBeNull()
  })

  it('ordnet "Coding Cap Set ..." nicht "Coding Cap einzeln" zu', () => {
    expect(matchProduct('Coding Cap Set 12-fach', WEIGHT_LIST).entry?.name).toBe('Coding Cap Set')
  })

  it('übernimmt unsichere Treffer niemals automatisch', () => {
    const result = matchProduct('Verschluss irgendwas', WEIGHT_LIST)
    expect(result.entry).toBeNull()
    expect(result.matchType).toBe('none')
  })

  it('bietet bei unklaren Bezeichnungen Vorschläge an', () => {
    const result = matchProduct('Sicherheits-Verschluss', WEIGHT_LIST)
    expect(result.entry).toBeNull()
    expect(result.suggestions[0]?.entry.name).toBe('Sicherheitsverschluss')
  })

  it('verwendet dauerhaft gespeicherte manuelle Zuordnungen', () => {
    saveManualMapping('Hausintern XY-42', { name: 'Mini Trigger', unitWeightGrams: 16 })
    const result = matchProduct('Hausintern XY-42', WEIGHT_LIST)
    expect(result.matchType).toBe('manual')
    expect(result.entry?.unitWeightGrams).toBe(16)
  })

  it('verwendet Zuordnungen aus dem aktuellen Durchlauf', () => {
    const result = matchProduct('Noch unbekannt', WEIGHT_LIST, {
      'noch unbekannt': { name: 'Sprayer K3', unitWeightGrams: 35 },
    })
    expect(result.matchType).toBe('manual')
    expect(result.entry?.unitWeightGrams).toBe(35)
  })
})

describe('Gewichtsliste (hinterlegte Daten)', () => {
  it('enthält alle 23 Produkte der Word-Datei', () => {
    expect(GEWICHTSLISTE).toHaveLength(23)
  })

  it('führt die Gewichte in Gramm je Stück', () => {
    expect(GEWICHTSLISTE.find((e) => e.name === 'Sprayer K2')?.unitWeightGrams).toBe(50)
    expect(GEWICHTSLISTE.find((e) => e.name === 'DPZ Hobby 1.0L')?.unitWeightGrams).toBe(330)
    expect(GEWICHTSLISTE.find((e) => e.name === 'Schraubverschluss')?.unitWeightGrams).toBe(4)
  })

  it('enthält keine doppelten Produktbezeichnungen', () => {
    const names = GEWICHTSLISTE.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
