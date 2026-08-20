// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { matchProduct } from '../productMatcher'
import { clearManualMappings, saveManualMapping } from '../mappingStore'
import { GEWICHTSLISTE } from '../../data/gewichtsliste'
import type { ProductWeightEntry } from '../../types'

const WEIGHT_LIST: ProductWeightEntry[] = GEWICHTSLISTE

beforeEach(() => {
  clearManualMappings()
})

describe('matchProduct', () => {
  it('findet exakte Treffer', () => {
    const result = matchProduct('Sprayer K2', WEIGHT_LIST)
    expect(result.matchType).toBe('exact')
    expect(result.entry?.unitWeightGrams).toBe(50)
  })

  it('findet normalisierte Treffer (Leerzeichen/Groß-Klein)', () => {
    const result = matchProduct('  sprayer   k2 ', WEIGHT_LIST)
    expect(result.matchType).toBe('normalized')
    expect(result.entry?.unitWeightGrams).toBe(50)
  })

  it('ordnet "Sprayer K2 ..." dem Eintrag "Sprayer K2" zu (50 g)', () => {
    const result = matchProduct('Sprayer K2 rot mit Kappe, 28/410', WEIGHT_LIST)
    expect(result.matchType).toBe('prefix')
    expect(result.entry?.name).toBe('Sprayer K2')
    expect(result.entry?.unitWeightGrams).toBe(50)
  })

  it('bevorzugt bei Präfix-Treffern den längsten passenden Eintrag', () => {
    const result = matchProduct('DPZ Profi 1.5L C+ blau transparent', WEIGHT_LIST)
    expect(result.matchType).toBe('prefix')
    expect(result.entry?.name).toBe('DPZ Profi 1.5L C+')
    expect(result.entry?.unitWeightGrams).toBe(475)
  })

  it('unterscheidet "Sprayer K2" von einer anderen Artikelnummer wie "Sprayer K20"', () => {
    const result = matchProduct('Sprayer K20 spezial', WEIGHT_LIST)
    expect(result.matchType).not.toBe('prefix')
    expect(result.entry).toBeNull()
  })

  it('ordnet "Coding Cap Set ..." nicht versehentlich "Coding Cap einzeln" zu', () => {
    const result = matchProduct('Coding Cap Set 12-fach', WEIGHT_LIST)
    expect(result.entry?.name).toBe('Coding Cap Set')
    expect(result.entry?.unitWeightGrams).toBe(25)
  })

  it('übernimmt unsichere Treffer niemals automatisch', () => {
    const result = matchProduct('Verschluss irgendwas', WEIGHT_LIST)
    expect(result.entry).toBeNull()
    expect(result.matchType).toBe('none')
  })

  it('bietet bei unklaren Bezeichnungen Vorschläge an', () => {
    const result = matchProduct('Sicherheits-Verschluss', WEIGHT_LIST)
    expect(result.entry).toBeNull()
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions[0].entry.name).toBe('Sicherheitsverschluss')
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
