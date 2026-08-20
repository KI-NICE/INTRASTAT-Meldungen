// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { matchProduct } from '../productMatcher'
import { clearManualMappings, saveManualMapping } from '../mappingStore'
import type { ProductWeightEntry } from '../../types'

const WEIGHT_LIST: ProductWeightEntry[] = [
  { name: 'DPZ Hobby 1.0L', unitWeightGrams: 330 },
  { name: 'DPZ Profi 1.5L', unitWeightGrams: 450 },
  { name: 'DPZ Profi 1.5L C+', unitWeightGrams: 475 },
]

beforeEach(() => {
  clearManualMappings()
})

describe('matchProduct', () => {
  it('findet exakte Treffer', () => {
    const result = matchProduct('DPZ Hobby 1.0L', WEIGHT_LIST)
    expect(result.matchType).toBe('exact')
    expect(result.entry?.unitWeightGrams).toBe(330)
  })

  it('findet normalisierte Treffer (Leerzeichen/Groß-Klein)', () => {
    const result = matchProduct('  dpz hobby 1.0l  ', WEIGHT_LIST)
    expect(result.matchType).toBe('normalized')
    expect(result.entry?.unitWeightGrams).toBe(330)
  })

  it('übernimmt niemals unsichere Treffer automatisch', () => {
    const result = matchProduct('DPZ Profi', WEIGHT_LIST)
    expect(result.matchType).toBe('none')
    expect(result.entry).toBeNull()
  })

  it('liefert bei mehreren ähnlichen Bezeichnungen mehrere Vorschläge', () => {
    const result = matchProduct('DPZ Profi 1.5L C', WEIGHT_LIST)
    expect(result.matchType).toBe('none')
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1)
  })

  it('verwendet zuvor manuell bestätigte Zuordnungen (dauerhaft gespeichert)', () => {
    saveManualMapping('Unbekanntes Teil', { name: 'DPZ Profi 1.5L', unitWeightGrams: 450 })
    const result = matchProduct('Unbekanntes Teil', WEIGHT_LIST)
    expect(result.matchType).toBe('manual')
    expect(result.entry?.unitWeightGrams).toBe(450)
  })

  it('verwendet Zuordnungen aus dem aktuellen Durchlauf (sessionMappings)', () => {
    const result = matchProduct(
      'Noch unbekannt',
      WEIGHT_LIST,
      { 'noch unbekannt': { name: 'DPZ Hobby 1.0L', unitWeightGrams: 330 } },
    )
    expect(result.matchType).toBe('manual')
    expect(result.entry?.unitWeightGrams).toBe(330)
  })
})
