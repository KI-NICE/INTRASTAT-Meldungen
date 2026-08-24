// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadWeightListHistory,
  saveWeightListVersion,
  clearWeightListHistory,
} from '../weightListHistory'

beforeEach(() => {
  clearWeightListHistory('ST', 'V')
  clearWeightListHistory('ST', 'E')
  clearWeightListHistory('SPC', 'V')
  clearWeightListHistory('SPC', 'E')
})

describe('Gewichtslisten-Verlauf', () => {
  it('speichert eine neue Version an erster Stelle', () => {
    saveWeightListVersion('ST', 'V', { A: 10 }, 'a.docx')
    saveWeightListVersion('ST', 'V', { B: 20 }, 'b.docx')

    const history = loadWeightListHistory('ST', 'V')
    expect(history).toHaveLength(2)
    expect(history[0].sourceFileName).toBe('b.docx')
    expect(history[1].sourceFileName).toBe('a.docx')
  })

  it('behält höchstens die letzten 5 Versionen, ältester Eintrag fällt zuerst weg', () => {
    for (let i = 1; i <= 6; i++) {
      saveWeightListVersion('ST', 'V', { [`V${i}`]: i }, `v${i}.docx`)
    }

    const history = loadWeightListHistory('ST', 'V')
    expect(history).toHaveLength(5)
    // Die neueste (v6) steht vorne, die älteste verbliebene ist v2 - v1 ist herausgefallen.
    expect(history[0].sourceFileName).toBe('v6.docx')
    expect(history[4].sourceFileName).toBe('v2.docx')
    expect(history.some((v) => v.sourceFileName === 'v1.docx')).toBe(false)
  })

  it('liefert einen leeren Verlauf ohne gespeicherte Versionen', () => {
    expect(loadWeightListHistory('ST', 'V')).toEqual([])
  })

  it('clearWeightListHistory löscht den Verlauf einer Firma/Richtung', () => {
    saveWeightListVersion('ST', 'V', { A: 10 })
    clearWeightListHistory('ST', 'V')
    expect(loadWeightListHistory('ST', 'V')).toEqual([])
  })

  it('führt getrennte Verläufe für Ausgangs- und Eingangsrechnungen', () => {
    saveWeightListVersion('ST', 'V', { A: 10 }, 'ar.xlsx')
    saveWeightListVersion('ST', 'E', { B: 20 }, 'er.xlsx')

    expect(loadWeightListHistory('ST', 'V')).toHaveLength(1)
    expect(loadWeightListHistory('ST', 'E')).toHaveLength(1)
    expect(loadWeightListHistory('ST', 'V')[0].sourceFileName).toBe('ar.xlsx')
    expect(loadWeightListHistory('ST', 'E')[0].sourceFileName).toBe('er.xlsx')
  })

  it('führt getrennte Verläufe je Firma (KST/KSPC)', () => {
    saveWeightListVersion('ST', 'V', { A: 10 }, 'st.xlsx')
    saveWeightListVersion('SPC', 'V', { B: 20 }, 'spc.xlsx')

    expect(loadWeightListHistory('ST', 'V')).toHaveLength(1)
    expect(loadWeightListHistory('SPC', 'V')).toHaveLength(1)
    expect(loadWeightListHistory('ST', 'V')[0].sourceFileName).toBe('st.xlsx')
    expect(loadWeightListHistory('SPC', 'V')[0].sourceFileName).toBe('spc.xlsx')
  })
})
