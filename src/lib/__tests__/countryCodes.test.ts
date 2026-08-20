import { describe, it, expect } from 'vitest'
import { resolveCountryToken, detectCountryFromAddress, listKnownCountries } from '../countryCodes'

describe('resolveCountryToken', () => {
  it('übersetzt die klassischen Länderkennzeichen', () => {
    expect(resolveCountryToken('A')).toBe('AT')
    expect(resolveCountryToken('B')).toBe('BE')
    expect(resolveCountryToken('D')).toBe('DE')
    expect(resolveCountryToken('F')).toBe('FR')
    expect(resolveCountryToken('I')).toBe('IT')
    expect(resolveCountryToken('E')).toBe('ES')
    expect(resolveCountryToken('L')).toBe('LU')
    expect(resolveCountryToken('S')).toBe('SE')
    expect(resolveCountryToken('H')).toBe('HU')
    expect(resolveCountryToken('P')).toBe('PT')
    expect(resolveCountryToken('SLO')).toBe('SI')
    expect(resolveCountryToken('NL')).toBe('NL')
  })

  it('erkennt ausgeschriebene Ländernamen (deutsch und englisch)', () => {
    expect(resolveCountryToken('Österreich')).toBe('AT')
    expect(resolveCountryToken('Frankreich')).toBe('FR')
    expect(resolveCountryToken('Italy')).toBe('IT')
    expect(resolveCountryToken('  belgien ')).toBe('BE')
  })

  it('gibt null zurück, wenn nichts eindeutig zuordenbar ist', () => {
    expect(resolveCountryToken('Nirgendland')).toBeNull()
    expect(resolveCountryToken('XY')).toBeNull()
    expect(resolveCountryToken('')).toBeNull()
    expect(resolveCountryToken(undefined)).toBeNull()
  })
})

describe('detectCountryFromAddress', () => {
  it('erkennt das Kennzeichen vor der Postleitzahl', () => {
    const result = detectCountryFromAddress('Kunde AG\nHandelskaai 12\nA-1010 Wien')
    expect(result.code).toBe('AT')
    expect(result.token).toBe('A')
    expect(result.source).toBe('plz-praefix')
  })

  it('funktioniert auch mit Leerzeichen um den Bindestrich', () => {
    expect(detectCountryFromAddress('NL - 1234 AB Amsterdam').code).toBe('NL')
  })

  it('erkennt einen ausgeschriebenen Ländernamen in eigener Zeile', () => {
    const result = detectCountryFromAddress('Kunde AG\nRue 5\n1000 Bruxelles\nBelgien')
    expect(result.code).toBe('BE')
    expect(result.source).toBe('landname')
  })

  it('meldet ein unbekanntes Kennzeichen als Token ohne Code', () => {
    const result = detectCountryFromAddress('Kunde AG\nVia Roma 1\nXY-00100 Roma')
    expect(result.code).toBeNull()
    expect(result.token).toBe('XY')
  })

  it('liefert kein Token, wenn nichts erkennbar ist', () => {
    const result = detectCountryFromAddress('Kunde AG\nSome Street 5')
    expect(result.code).toBeNull()
    expect(result.token).toBeNull()
    expect(result.source).toBe('kein-token')
  })
})

describe('listKnownCountries', () => {
  it('liefert eindeutige, alphabetisch sortierte Länder mit ISO-Code', () => {
    const list = listKnownCountries()
    expect(list.length).toBeGreaterThan(25)
    const codes = list.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(list[0].name.localeCompare(list[1].name, 'de')).toBeLessThanOrEqual(0)
  })
})
