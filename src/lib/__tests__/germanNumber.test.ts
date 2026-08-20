import { describe, it, expect } from 'vitest'
import { parseGermanNumber, roundUp, roundCommercial } from '../germanNumber'

describe('parseGermanNumber', () => {
  it('parst Zahlen mit Tausenderpunkt und Komma', () => {
    expect(parseGermanNumber('1.234,56')).toBeCloseTo(1234.56)
  })

  it('parst Zahlen nur mit Komma', () => {
    expect(parseGermanNumber('127,00')).toBeCloseTo(127)
  })

  it('parst ganze Zahlen ohne Trennzeichen', () => {
    expect(parseGermanNumber('127')).toBe(127)
  })

  it('entfernt Währungssymbole und Einheiten', () => {
    expect(parseGermanNumber('1.250,00 EUR')).toBeCloseTo(1250)
    expect(parseGermanNumber('250 kg')).toBeCloseTo(250)
  })

  it('gibt null bei leerem oder unklarem Input zurück', () => {
    expect(parseGermanNumber('')).toBeNull()
    expect(parseGermanNumber(undefined)).toBeNull()
    expect(parseGermanNumber('abc')).toBeNull()
  })

  it('unterscheidet Tausenderpunkt von Dezimalpunkt heuristisch', () => {
    expect(parseGermanNumber('1.500')).toBeCloseTo(1500) // Tausenderpunkt
  })
})

describe('roundUp', () => {
  it('rundet immer auf', () => {
    expect(roundUp(3.01)).toBe(4)
    expect(roundUp(3.99)).toBe(4)
    expect(roundUp(3)).toBe(3)
    expect(roundUp(0)).toBe(0)
  })

  it('ist robust gegenüber Fließkomma-Rundungsfehlern', () => {
    expect(roundUp(2.9999999999)).toBe(3)
  })
})

describe('roundCommercial', () => {
  it('rundet kaufmännisch', () => {
    expect(roundCommercial(2.5)).toBe(3)
    expect(roundCommercial(2.49)).toBe(2)
  })
})
