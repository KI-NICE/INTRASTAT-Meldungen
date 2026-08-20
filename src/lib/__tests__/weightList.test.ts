import { describe, it, expect } from 'vitest'
import { parseWeightListText } from '../weightList'

const SAMPLE = `Produkt\t\t\t\t\t\t\tGewicht\t\t\tZusatz

DPZ Hobby 1.0L\t\t\t\t\t\t330 g

Fingerdruckzerstäuber MVII\t\t\t\t    9 g\t\t\t\tinkl. Kappe

Xtenso 15 cm\t\t\t\t\t\t  26 g
`

describe('parseWeightListText', () => {
  it('parst Produktname und Gewicht in Gramm', () => {
    const entries = parseWeightListText(SAMPLE)
    expect(entries).toEqual([
      { name: 'DPZ Hobby 1.0L', unitWeightGrams: 330, zusatz: undefined },
      { name: 'Fingerdruckzerstäuber MVII', unitWeightGrams: 9, zusatz: 'inkl. Kappe' },
      { name: 'Xtenso 15 cm', unitWeightGrams: 26, zusatz: undefined },
    ])
  })

  it('ignoriert die Kopfzeile und Leerzeilen', () => {
    const entries = parseWeightListText(SAMPLE)
    expect(entries.some((e) => e.name.toLowerCase() === 'produkt')).toBe(false)
  })
})
